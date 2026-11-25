<?php
namespace Kanboard\Plugin\HotDogPress\Model;

use Kanboard\Core\Base;

/**
 * The portable `.hotdog` file. In Kanboard an image asset (kind "image") is a project file (`file_id`); in a .hotdog
 * file it is inline (`data`, a data URL), so the file opens anywhere. Export inlines any file_id, import writes the
 * inline images back as project files of the target project.
 *
 * The file may be larger than a stored Dog because of its images: MAX_BYTES caps the file, ZineImages::MAX_BYTES
 * each image, and the Dog left after the images are taken out must fit DogValidator::MAX_BYTES.
 */
class HotdogFile extends Base
{
    public const MAX_BYTES = 16 * 1024 * 1024;

    /**
     * The zine's Dog, pretty-printed, with its project's images inlined; any other file_id becomes a placeholder.
     * Assets no item uses (a photo replaced or deleted in an older editor) are left out rather than inlined.
     */
    public function export(array $zine): string
    {
        $dog = json_decode($zine['document']); // objects, so {} stays {}
        $images = new ZineImages($this->container);
        if (is_object($dog->assets ?? null)) {
            $used = [];
            foreach (is_array($dog->pages ?? null) ? $dog->pages : [] as $page) {
                foreach (is_array($page->items ?? null) ? $page->items : [] as $item) {
                    if (is_string($item->asset ?? null)) {
                        $used[$item->asset] = true;
                    }
                }
            }
            foreach (array_keys(get_object_vars($dog->assets)) as $id) {
                if (! isset($used[$id])) {
                    unset($dog->assets->{$id});
                }
            }
        }
        foreach (is_object($dog->assets ?? null) ? $dog->assets : [] as $asset) {
            if (! is_object($asset) || ! property_exists($asset, 'file_id')) {
                continue;
            }
            $fileId = filter_var($asset->file_id, FILTER_VALIDATE_INT);
            $image = $fileId === false ? null : $images->read((int) $zine['project_id'], $fileId);
            unset($asset->file_id);
            if ($image === null) {
                $asset->kind = 'placeholder';
            } else {
                $asset->data = ZineImages::dataUrl($image['mime'], $image['bytes']);
            }
        }
        return json_encode($dog, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    }

    /**
     * A new zine in $projectId from a .hotdog file's text. Nothing is written unless the whole file is good: the
     * images are checked (size, sniffed type) and the Dog migrated and validated (strict: an unknown field is
     * refused, as on save) first.
     *
     * @throws ZineRejected too_large, bad_request, unsupported, invalid or unavailable
     */
    public function import(string $text, int $projectId, int $userId): int
    {
        if (strlen($text) > self::MAX_BYTES) {
            throw new ZineRejected('too_large', 'A .hotdog file must be at most 16 MB.');
        }
        $dog = DogValidator::decode($text) ?? throw new ZineRejected('bad_request', 'This is not a .hotdog file.');

        // The asset cap is checked first, so a file of thousands of tiny images costs no image work before it is refused.
        // The full validation below still decides everything else.
        if (array_key_exists('assets', $dog)) {
            if (! is_array($dog['assets'])) {
                throw new ZineRejected('bad_request', 'This is not a .hotdog file.');
            }
            if (count($dog['assets']) > DogValidator::MAX_ASSETS) {
                throw new ZineRejected('invalid', 'A zine must have at most 500 assets.'); // DogValidator::MAX_ASSETS
            }
        }

        // Inline images leave the Dog before it is checked; file_id 1 (a valid id, never kept) holds their place until
        // they are stored.
        // Other kinds with data (stickers) stay inline, as the editor saves them.
        $inline = [];
        foreach (is_array($dog['assets'] ?? null) ? $dog['assets'] : [] as $id => $asset) {
            if (is_array($asset) && ($asset['kind'] ?? null) === 'image' && array_key_exists('data', $asset)) {
                $bytes = ZineImages::fromDataUrl($asset['data'])
                    ?? throw new ZineRejected('unsupported', 'Only JPEG, PNG and WebP images are accepted.');
                ZineImages::checked($bytes);
                $inline[$id] = $bytes;
                unset($dog['assets'][$id]['data']);
                $dog['assets'][$id]['file_id'] = 1;
            }
        }

        $zines = new ZineModel($this->container);
        $dog = $zines->document(self::encode($dog)); // migrated, strict, and the stored-size cap

        $images = new ZineImages($this->container);
        $stored = [];
        try {
            foreach ($inline as $id => $bytes) {
                $file = $images->store($projectId, $bytes, 'hotdogpress-import-'.ZineModel::randomId(8));
                $stored[] = $file['file_id'];
                $dog['assets'][$id]['file_id'] = $file['file_id'];
            }
        } catch (ZineRejected $e) {
            foreach ($stored as $fileId) {
                $this->projectFileModel->remove($fileId);
            }
            throw $e;
        }
        $title = is_string($dog['title'] ?? null) ? $dog['title'] : '';
        return $zines->create($projectId, $title, self::encode($dog), $userId);
    }

    /**
     * JSON for a decoded (associative) Dog. json_decode turns {} into [], so the empty arrays where Dog 1 has
     * objects (assets, an asset, an item's attrs) go back to {}. Untyped values (look, bg, …) are not known to be
     * objects and stay as decoded.
     */
    private static function encode(array $dog): string
    {
        $object = fn ($v) => $v === [] ? new \stdClass() : $v;
        if (is_array($dog['assets'] ?? null)) {
            $dog['assets'] = $object(array_map($object, $dog['assets']));
        }
        foreach ($dog['pages'] ?? [] as $p => $page) {
            foreach (is_array($page['items'] ?? null) ? $page['items'] : [] as $i => $item) {
                if (is_array($item) && array_key_exists('attrs', $item)) {
                    $dog['pages'][$p]['items'][$i]['attrs'] = $object($item['attrs']);
                }
            }
        }
        return json_encode($dog, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    }
}
