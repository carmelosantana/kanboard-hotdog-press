<?php
namespace Kanboard\Plugin\HotDogPress\Model;

/**
 * The PHP mirror of validateDog in Assets/js/core/dog.js: the same rules, error paths and messages, driven by the
 * same fixtures (Test/fixtures/dog). It guards the save endpoint; the JS copy guards the editor and the compiler.
 *
 * validate() returns ['ok' => true, 'dog' => array] or ['ok' => false, 'errors' => [['path' => ..., 'message' => ...]]].
 */
class DogValidator
{
    public const VERSION = 1;
    public const MAX_BYTES = 2 * 1024 * 1024;
    public const MAX_INK_POINTS = 5000;
    public const MAX_TEXT_CHARS = 2000;
    // An optional issue label: a string of at most this many characters, or a whole number of 0 or more.
    public const MAX_ISSUE_CHARS = 32;
    public const MAX_MARGIN_MM = 10;
    // Item geometry in panel units may reach a panel beyond either edge (bleed, drag-off).
    public const MIN_UNIT = -1;
    public const MAX_UNIT = 2;

    public const PAPERS = ['a4', 'letter'];
    public const LAYOUTS = [
        'cover', 'back-cover', 'headline-body', 'photo-full', 'photo-caption', 'list', 'quote', 'two-up', 'freeform',
    ];
    // Asset ids like "0" would make the assets map a JSON list in PHP, so both languages refuse them.
    private const NUMERIC_ID = '/^[0-9]+$/';
    public const BY = ['hand', 'ai', 'import'];

    // Allowed fields per object, for strict mode: an item may carry 'item' plus its own type's fields.
    public const FIELDS = [
        'dog' => ['hotdog', 'id', 'title', 'issue', 'paper', 'margin_mm', 'look', 'assets', 'pages'],
        'page' => ['id', 'layout', 'bg', 'items'],
        'item' => ['id', 'type', 'x', 'y', 'w', 'h', 'rot', 'by', 'locked', 'slot', 'attrs'],
        'types' => [
            'text' => ['font', 'size', 'align', 'color', 'runs'],
            'image' => ['asset', 'fit', 'focus', 'crop'],
            'shape' => ['shape', 'fill', 'stroke', 'stroke_width'],
            'ink' => ['points', 'width', 'color'],
            'sticker' => ['asset'],
        ],
        'asset' => ['kind', 'file_id', 'data', 'w', 'h', 'name'],
    ];

    private array $errors = [];
    private bool $strict = false;
    private array $assets = [];
    private array $itemIds = [];

    /**
     * Brings an older Dog forward to VERSION; a missing 'hotdog' counts as 0. Unknown or newer versions come back
     * unchanged for validate() to report.
     */
    public static function migrate(array $dog): array
    {
        // Compare before casting: (int) of null or a huge float is 0, which would migrate a Dog JS rejects.
        $v = array_key_exists('hotdog', $dog) ? $dog['hotdog'] : 0;
        if (! self::isInteger($v) || $v < 0 || $v >= self::VERSION) {
            return $dog;
        }
        $v = (int) $v;
        while ($v < self::VERSION) {
            $dog = self::migration($v, $dog);
            unset($dog['hotdog']);
            $v++;
            $dog = ['hotdog' => $v] + $dog;
        }
        return $dog;
    }

    /** Turns a version-$from Dog into version $from + 1. */
    private static function migration(int $from, array $dog): array
    {
        return match ($from) {
            0 => $dog, // No shape change; the hook exists for Dog 2.
        };
    }

    /** Migrates, then checks every rule. 'lenient' keeps unknown fields; 'strict' reports them. */
    public static function validate(array $dog, string $mode): array
    {
        if (! self::isObject($dog)) {
            return self::fail('must be an object');
        }
        $json = json_encode($dog, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        if ($json === false) {
            return self::fail('must be valid JSON');
        }
        if (strlen($json) > self::MAX_BYTES) {
            return self::fail('must be at most '.self::MAX_BYTES.' bytes of JSON');
        }

        $dog = self::migrate($dog);
        $v = new self();
        $v->strict = $mode === 'strict';
        $v->check($dog);

        return $v->errors ? ['ok' => false, 'errors' => $v->errors] : ['ok' => true, 'dog' => $dog];
    }

    private function check(array $dog): void
    {
        $this->unknown($dog, self::FIELDS['dog'], []);
        $hotdog = $dog['hotdog'] ?? null;
        if ($hotdog !== self::VERSION && $hotdog !== (float) self::VERSION) {
            $this->error(['hotdog'], 'must be the integer 1');
        }
        if (array_key_exists('issue', $dog) && ! self::validIssue($dog['issue'])) {
            $this->error(
                ['issue'],
                'must be a string of at most '.self::MAX_ISSUE_CHARS.' characters or an integer of 0 or more',
            );
        }
        if (! in_array($dog['paper'] ?? null, self::PAPERS, true)) {
            $this->error(['paper'], 'must be one of '.implode(', ', self::PAPERS));
        }
        if (! self::inRange($dog['margin_mm'] ?? null, 0, self::MAX_MARGIN_MM)) {
            $this->error(['margin_mm'], 'must be a number from 0 to '.self::MAX_MARGIN_MM);
        }

        // is_array, not isObject: json_decode turns an object whose keys are all numeric into a list.
        $assets = $dog['assets'] ?? null;
        if (is_array($assets)) {
            $this->assets = $assets;
        } else {
            $this->error(['assets'], 'must be an object');
        }
        foreach ($this->assets as $key => $asset) {
            if (preg_match(self::NUMERIC_ID, (string) $key)) {
                $this->error(['assets', $key], 'must not be a numeric-only id');
            } elseif (! self::isObject($asset)) {
                $this->error(['assets', $key], 'must be an object');
            } else {
                $this->unknown($asset, self::FIELDS['asset'], ['assets', $key]);
            }
        }

        $pages = $dog['pages'] ?? null;
        if (! self::isList($pages)) {
            $this->error(['pages'], 'must be an array');
            return;
        }
        if (count($pages) !== 8) {
            $this->error(['pages'], 'must have exactly 8 pages');
        }
        $pageIds = [];
        foreach ($pages as $p => $page) {
            $this->checkPage($page, ['pages', $p], $pageIds);
        }
    }

    private function checkPage(mixed $page, array $at, array &$pageIds): void
    {
        if (! self::isObject($page)) {
            $this->error($at, 'must be an object');
            return;
        }
        $this->unknown($page, self::FIELDS['page'], $at);
        $this->checkId($page['id'] ?? null, $pageIds, [...$at, 'id'], 'duplicate page id');
        if (! in_array($page['layout'] ?? null, self::LAYOUTS, true)) {
            $this->error([...$at, 'layout'], 'must be a known layout');
        }
        $items = $page['items'] ?? null;
        if (! self::isList($items)) {
            $this->error([...$at, 'items'], 'must be an array');
            return;
        }
        foreach ($items as $i => $item) {
            $this->checkItem($item, [...$at, 'items', $i]);
        }
    }

    private function checkItem(mixed $item, array $at): void
    {
        if (! self::isObject($item)) {
            $this->error($at, 'must be an object');
            return;
        }
        $type = $item['type'] ?? null;
        $typed = is_string($type) && array_key_exists($type, self::FIELDS['types']);
        if ($typed) {
            $this->unknown($item, [...self::FIELDS['item'], ...self::FIELDS['types'][$type]], $at);
        }
        $this->checkId($item['id'] ?? null, $this->itemIds, [...$at, 'id'], 'duplicate item id');
        if (! $typed) {
            $this->error([...$at, 'type'], 'must be one of '.implode(', ', array_keys(self::FIELDS['types'])));
        }

        // An ink stroke's geometry is its points, so its box is optional (checked when present).
        $box = fn (string $k): bool => $type !== 'ink' || array_key_exists($k, $item);
        foreach (['x', 'y'] as $k) {
            if ($box($k) && ! self::inRange($item[$k] ?? null, self::MIN_UNIT, self::MAX_UNIT)) {
                $this->error([...$at, $k], 'must be a number from '.self::MIN_UNIT.' to '.self::MAX_UNIT);
            }
        }
        foreach (['w', 'h'] as $k) {
            if ($box($k) && (! self::inRange($item[$k] ?? null, self::MIN_UNIT, self::MAX_UNIT) || $item[$k] <= 0)) {
                $this->error([...$at, $k], 'must be a number greater than 0 and at most '.self::MAX_UNIT);
            }
        }
        if (! in_array($item['by'] ?? null, self::BY, true)) {
            $this->error([...$at, 'by'], 'must be one of '.implode(', ', self::BY));
        }

        if ($type === 'image' || $type === 'sticker') {
            $asset = $item['asset'] ?? null;
            if (! is_string($asset) || ! array_key_exists($asset, $this->assets)) {
                $this->error([...$at, 'asset'], 'must name an entry in assets');
            }
        } elseif ($type === 'ink') {
            $this->checkPoints($item['points'] ?? null, [...$at, 'points']);
        } elseif ($type === 'text') {
            $this->checkRuns($item['runs'] ?? null, [...$at, 'runs']);
        }
    }

    private function checkPoints(mixed $points, array $path): void
    {
        $pairs = self::isList($points);
        foreach ($pairs ? $points : [] as $pt) {
            if (! self::isList($pt) || count($pt) !== 2
                || ! self::inRange($pt[0], self::MIN_UNIT, self::MAX_UNIT)
                || ! self::inRange($pt[1], self::MIN_UNIT, self::MAX_UNIT)) {
                $pairs = false;
                break;
            }
        }
        if (! $pairs) {
            $this->error($path, 'must be an array of [x, y] pairs from '.self::MIN_UNIT.' to '.self::MAX_UNIT);
        } elseif (count($points) > self::MAX_INK_POINTS) {
            $this->error($path, 'must have at most '.self::MAX_INK_POINTS.' points');
        }
    }

    private function checkRuns(mixed $runs, array $path): void
    {
        $chars = 0;
        $ok = self::isList($runs);
        foreach ($ok ? $runs : [] as $run) {
            if (! self::isObject($run) || ! is_string($run['text'] ?? null)) {
                $ok = false;
                break;
            }
            $chars += mb_strlen($run['text'], 'UTF-8');
        }
        if (! $ok) {
            $this->error($path, 'must be an array of runs with string text');
        } elseif ($chars > self::MAX_TEXT_CHARS) {
            $this->error($path, 'must have at most '.self::MAX_TEXT_CHARS.' characters in total');
        }
    }

    private function checkId(mixed $id, array &$seen, array $path, string $duplicate): void
    {
        if (! is_string($id) || $id === '') {
            $this->error($path, 'must be a non-empty string');
        } elseif (isset($seen[$id])) {
            $this->error($path, $duplicate);
        } else {
            $seen[$id] = true;
        }
    }

    private function unknown(array $obj, array $allowed, array $at): void
    {
        if (! $this->strict) {
            return;
        }
        foreach (array_keys($obj) as $key) {
            if (! in_array((string) $key, $allowed, true)) {
                $this->error([...$at, $key], 'unknown field');
            }
        }
    }

    private function error(array $segments, string $message): void
    {
        // JSON-pointer escaping (RFC 6901) of each segment.
        $escaped = array_map(fn ($s) => str_replace(['~', '/'], ['~0', '~1'], (string) $s), $segments);
        $this->errors[] = ['path' => implode('/', $escaped), 'message' => $message];
    }

    private static function fail(string $message): array
    {
        return ['ok' => false, 'errors' => [['path' => '', 'message' => $message]]];
    }

    /** A decoded JSON object. json_decode makes {} an empty array, so [] counts as an (empty) object. */
    private static function isObject(mixed $v): bool
    {
        return is_array($v) && ($v === [] || ! array_is_list($v));
    }

    private static function isList(mixed $v): bool
    {
        return is_array($v) && array_is_list($v);
    }

    private static function validIssue(mixed $v): bool
    {
        return is_string($v) ? mb_strlen($v, 'UTF-8') <= self::MAX_ISSUE_CHARS : self::isInteger($v) && $v >= 0;
    }

    private static function isInteger(mixed $v): bool
    {
        return is_int($v) || (is_float($v) && is_finite($v) && floor($v) === $v);
    }

    private static function inRange(mixed $v, int|float $min, int|float $max): bool
    {
        return (is_int($v) || (is_float($v) && is_finite($v))) && $v >= $min && $v <= $max;
    }
}
