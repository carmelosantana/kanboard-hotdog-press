<?php
namespace Kanboard\Plugin\HotDogPress\Model;

use Kanboard\Core\Base;
use Kanboard\Model\ProjectModel;
use PicoDb\Table;

/**
 * Zines in hotdogpress_zines: one row per zine, the Dog as JSON text in `document`, and a `revision` that every
 * write bumps. Saves are conditional on the revision the editor loaded, so two tabs cannot overwrite each other.
 *
 * Documents from the browser are stored verbatim: decoding and re-encoding in PHP turns {} into [] (assets).
 */
class ZineModel extends Base
{
    public const TABLE = 'hotdogpress_zines';
    public const TITLE_MAX = 255;
    private const LIST_COLUMNS = ['id', 'project_id', 'title', 'revision', 'created_by', 'updated_by', 'created_at', 'updated_at'];

    /** A new zine at revision 1; $json must already have passed document(). */
    public function create(int $projectId, string $title, string $json, int $userId): int
    {
        $now = time();
        return (int) $this->db->table(self::TABLE)->persist([
            'project_id' => $projectId,
            'title' => self::title($title),
            'document' => $json,
            'revision' => 1,
            'created_by' => $userId ?: null,
            'updated_by' => $userId ?: null,
            'created_at' => $now,
            'updated_at' => $now,
        ]);
    }

    public function getById(int $id): ?array
    {
        return $this->db->table(self::TABLE)->eq('id', $id)->findOne() ?: null;
    }

    public function revision(int $id): ?int
    {
        $revision = $this->db->table(self::TABLE)->eq('id', $id)->findOneColumn('revision');
        return $revision === false || $revision === null ? null : (int) $revision;
    }

    /** The project's zines without their documents, last changed first. */
    public function getAllByProject(int $projectId): array
    {
        return $this->db->table(self::TABLE)->columns(...self::LIST_COLUMNS)
            ->eq('project_id', $projectId)->desc('updated_at')->desc('id')->findAll();
    }

    /** Zines (without documents, with project_name) in the user's active projects, for the paginator. */
    public function queryForUser(int $userId): Table
    {
        $projectIds = $this->projectPermissionModel->getActiveProjectIds($userId);
        $columns = array_map(fn ($c) => self::TABLE.'.'.$c, self::LIST_COLUMNS);
        $query = $this->db->table(self::TABLE)
            ->columns(...$columns, ...[ProjectModel::TABLE.'.name AS project_name'])
            ->join(ProjectModel::TABLE, 'id', 'project_id');
        // PicoDb drops an empty IN (), which would match every zine.
        return $projectIds === [] ? $query->eq(self::TABLE.'.id', 0) : $query->in(self::TABLE.'.project_id', $projectIds);
    }

    /**
     * Replaces the document if the stored revision is still $revision; returns the new revision, or null when it
     * has moved on (or the zine is gone). The column title follows the Dog's title when it has one.
     */
    public function save(int $id, int $revision, string $json, int $userId): ?int
    {
        $values = ['document' => $json, 'updated_by' => $userId ?: null, 'updated_at' => time()];
        $title = json_decode($json, true)['title'] ?? null;
        if (is_string($title) && trim($title) !== '') {
            $values['title'] = self::title($title);
        }
        return $this->writeIf($id, $revision, $values) ? $revision + 1 : null;
    }

    /** Sets the title in the column and in the Dog, as a new revision; false if a save got in between. */
    public function rename(int $id, string $title, int $userId): bool
    {
        $zine = $this->getById($id);
        if ($zine === null) {
            return false;
        }
        $title = self::title($title);
        $dog = json_decode($zine['document']); // objects, so {} stays {}
        $dog->title = $title;
        return $this->writeIf($id, (int) $zine['revision'], [
            'title' => $title,
            'document' => json_encode($dog, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
            'updated_by' => $userId ?: null,
            'updated_at' => time(),
        ]);
    }

    public function remove(int $id): bool
    {
        return $this->db->table(self::TABLE)->eq('id', $id)->remove();
    }

    /**
     * Checks a Dog sent by a client and returns it decoded. The size cap applies to the raw text before decoding;
     * the Dog is decoded by DogValidator::decode (a JSON [] where Dog 1 has an object is refused, as in JS) and
     * must pass DogValidator in strict mode.
     *
     * @throws ZineRejected too_large, bad_request or invalid (extra: errors)
     */
    public function document(string $json): array
    {
        if (strlen($json) > DogValidator::MAX_BYTES) {
            throw new ZineRejected('too_large', 'A zine must be at most 2 MiB of JSON.');
        }
        $dog = DogValidator::decode($json) ?? throw new ZineRejected('bad_request', 'The zine must be a JSON object.');
        $result = DogValidator::validate($dog, 'strict');
        if (! $result['ok']) {
            throw new ZineRejected('invalid', 'The zine is not valid.', ['errors' => $result['errors']]);
        }
        return $result['dog'];
    }

    /** A strict Dog 1 with eight empty freeform pages. */
    public static function blankDocument(string $title): string
    {
        $pages = [];
        for ($p = 1; $p <= 8; $p++) {
            $pages[] = ['id' => "p$p", 'layout' => 'freeform', 'bg' => 'paper', 'items' => []];
        }
        return json_encode([
            'hotdog' => DogValidator::VERSION,
            'id' => 'z_'.self::randomId(8),
            'title' => self::title($title),
            'paper' => 'letter',
            'margin_mm' => 6,
            'look' => 'kraft',
            'assets' => new \stdClass(),
            'pages' => $pages,
        ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    }

    public static function title(string $title): string
    {
        $title = trim(preg_replace('/\s+/u', ' ', $title) ?? '');
        return $title === '' ? 'Untitled' : mb_substr($title, 0, self::TITLE_MAX, 'UTF-8');
    }

    /**
     * A file name from the title: lowercase ASCII letters and digits joined by dashes; "zine" when none are left.
     * No iconv transliteration: musl's (the Alpine image) turns accents into "?".
     */
    public static function fileSlug(string $title): string
    {
        $slug = trim((string) preg_replace('/[^a-z0-9]+/', '-', strtolower($title)), '-');
        return $slug === '' ? 'zine' : substr($slug, 0, 80);
    }

    public static function randomId(int $length): string
    {
        $alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
        $id = '';
        for ($i = 0; $i < $length; $i++) {
            $id .= $alphabet[random_int(0, 35)];
        }
        return $id;
    }

    /** UPDATE … WHERE id AND revision, bumping the revision; true when a row changed. */
    private function writeIf(int $id, int $revision, array $values): bool
    {
        $values['revision'] = $revision + 1;
        $set = implode(', ', array_map(fn ($c) => $this->db->escapeIdentifier($c).' = ?', array_keys($values)));
        $statement = $this->db->execute(
            'UPDATE '.$this->db->escapeIdentifier(self::TABLE).' SET '.$set.' WHERE id = ? AND revision = ?',
            [...array_values($values), $id, $revision],
        );
        return $statement !== false && $statement->rowCount() === 1;
    }
}
