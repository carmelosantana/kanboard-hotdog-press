<?php
namespace Kanboard\Plugin\HotDogPress\Model;

use Kanboard\Core\Base;

/**
 * A print PDF made in the browser, saved as a project file of the zine's project. Only bytes that start with a PDF
 * header are stored, under a name the server picks, with the same size cap as an image.
 */
class ZinePdf extends Base
{
    public const MAX_BYTES = ZineImages::MAX_BYTES;

    /**
     * @return array{file_id: int, name: string}
     * @throws ZineRejected too_large, unsupported or unavailable
     */
    public function store(int $projectId, string $bytes, string $name): array
    {
        if (strlen($bytes) > self::MAX_BYTES) {
            throw new ZineRejected('too_large', 'A PDF must be at most 10 MB.');
        }
        if (! preg_match('/^%PDF-\d\.\d/', $bytes)) {
            throw new ZineRejected('unsupported', 'Only a PDF made by the editor can be saved here.');
        }
        $fileId = $this->projectFileModel->uploadContent($projectId, $name, $bytes, false);
        if (! $fileId) {
            throw new ZineRejected('unavailable', 'The PDF could not be stored, try again.');
        }
        return ['file_id' => (int) $fileId, 'name' => $name];
    }
}
