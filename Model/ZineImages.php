<?php
namespace Kanboard\Plugin\HotDogPress\Model;

use Kanboard\Core\Base;
use Kanboard\Core\ObjectStorage\ObjectStorageException;

/**
 * Zine images are Kanboard project files. Only JPEG, PNG and WebP are accepted or served, and the type always comes
 * from the bytes (magic number plus a header getimagesize can read), never from a file name or a client's claim.
 * Pure PHP: the stock Kanboard image has no fileinfo extension.
 */
class ZineImages extends Base
{
    public const MAX_BYTES = 10 * 1024 * 1024;
    public const TYPES = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];

    /** ['mime', 'w', 'h'] for a JPEG, PNG or WebP image; null for anything else. */
    public static function sniff(string $bytes): ?array
    {
        $mime = match (true) {
            str_starts_with($bytes, "\xFF\xD8\xFF") => 'image/jpeg',
            str_starts_with($bytes, "\x89PNG\r\n\x1A\n") => 'image/png',
            str_starts_with($bytes, 'RIFF') && substr($bytes, 8, 4) === 'WEBP' => 'image/webp',
            default => null,
        };
        $info = $mime === null ? false : @getimagesizefromstring($bytes);
        if ($info === false || $info['mime'] !== $mime || $info[0] < 1 || $info[1] < 1) {
            return null;
        }
        return ['mime' => $mime, 'w' => $info[0], 'h' => $info[1]];
    }

    /**
     * Stores $bytes as a file of the project, named $stem plus the sniffed extension.
     *
     * @return array{file_id: int, mime: string, w: int, h: int}
     * @throws ZineRejected too_large, unsupported or unavailable
     */
    public function store(int $projectId, string $bytes, string $stem): array
    {
        $image = self::checked($bytes);
        $fileId = $this->projectFileModel->uploadContent($projectId, $stem.'.'.self::TYPES[$image['mime']], $bytes, false);
        if (! $fileId) {
            throw new ZineRejected('unavailable', 'The image could not be stored, try again.');
        }
        return ['file_id' => (int) $fileId] + $image;
    }

    /**
     * The sniffed type of $bytes, refusing anything over MAX_BYTES or not an accepted image.
     *
     * @throws ZineRejected too_large or unsupported
     */
    public static function checked(string $bytes): array
    {
        if (strlen($bytes) > self::MAX_BYTES) {
            throw new ZineRejected('too_large', 'An image must be at most 10 MB.');
        }
        return self::sniff($bytes) ?? throw new ZineRejected('unsupported', 'Only JPEG, PNG and WebP images are accepted.');
    }

    /**
     * A project file of $projectId that is an accepted image, or null (missing, another project's, unreadable or
     * not an image).
     *
     * @return array{mime: string, w: int, h: int, bytes: string, name: string}|null
     */
    public function read(int $projectId, int $fileId): ?array
    {
        $file = $this->projectFileModel->getById($fileId);
        if (empty($file) || (int) $file['project_id'] !== $projectId) {
            return null;
        }
        try {
            $bytes = (string) $this->objectStorage->get($file['path']);
        } catch (ObjectStorageException) {
            return null;
        }
        $image = self::sniff($bytes);
        return $image === null ? null : $image + ['bytes' => $bytes, 'name' => (string) $file['name']];
    }

    public static function dataUrl(string $mime, string $bytes): string
    {
        return 'data:'.$mime.';base64,'.base64_encode($bytes);
    }

    /** The bytes of a base64 data URL, or null when it is not one. The declared type is ignored (sniff instead). */
    public static function fromDataUrl(mixed $url): ?string
    {
        if (! is_string($url) || ! preg_match('~^data:[a-z0-9.+/-]*(?:;[a-z0-9=.-]+)*;base64,~i', $url, $m)) {
            return null;
        }
        $bytes = base64_decode(substr($url, strlen($m[0])), true);
        return $bytes === false ? null : $bytes;
    }
}
