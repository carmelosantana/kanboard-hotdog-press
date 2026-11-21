<?php
namespace Kanboard\Plugin\HotDogPress\Controller;

use Kanboard\Controller\BaseController;
use Kanboard\Plugin\HotDogPress\Model\ZineImages;
use Kanboard\Plugin\HotDogPress\Model\ZineModel;
use Kanboard\Plugin\HotDogPress\Model\ZineRejected;

/**
 * The editor's JSON API, all under hotdogpress/zine/:zine_id/…
 *
 *   GET  load                {id, project_id, title, revision, can_edit, document}   (viewer)
 *   POST save                form: revision, document (Dog JSON text), csrf_token    (member)
 *                            → {ok: true, revision} | 409 {error: "conflict", revision}
 *   POST upload              multipart: image, csrf_token → {ok: true, file_id, mime, w, h}   (member)
 *   GET  image/:file_id      the project file's bytes, images only                    (viewer)
 *
 * Writes take the reusable CSRF token (the editor saves many times, and sendBeacon on pagehide). Errors are JSON:
 * {error: code, message, …} with the status from JsonErrors.
 */
class ZineApiController extends BaseController
{
    use JsonErrors;
    use ZineAccess;

    public const IMAGE_CACHE_SECONDS = 86400;

    /** Sent by PHP's session cache limiter at session start; they contradict Cache-Control on an image. */
    private const DROPPED_HEADERS = ['Expires', 'Pragma'];

    public function load(): void
    {
        $this->json(function () {
            $zine = $this->zineFor('load');
            $meta = json_encode([
                'id' => (int) $zine['id'],
                'project_id' => (int) $zine['project_id'],
                'title' => $zine['title'],
                'revision' => (int) $zine['revision'],
                'can_edit' => $this->can('ZineApiController', 'save', (int) $zine['project_id']),
            ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
            // The stored text goes out as is: it was valid JSON when saved, and decoding would turn {} into [].
            $this->response
                ->withContentType('application/json')
                ->withoutCache()
                ->withBody(substr($meta, 0, -1).',"document":'.$zine['document'].'}')
                ->send();
        });
    }

    public function save(): void
    {
        $this->json(function () {
            $this->checkReusableCSRFParam();
            $zine = $this->zineFor('save');
            $json = $this->request->getRawValue('document');
            $revision = $this->request->getRawValue('revision');
            if (! is_string($json) || ! is_string($revision) || ! ctype_digit($revision)) {
                throw new ZineRejected('bad_request', 'A save needs a revision and a document.');
            }
            $zines = new ZineModel($this->container);
            $zines->document($json);
            $id = (int) $zine['id'];
            $saved = $zines->save($id, (int) $revision, $json, (int) $this->userSession->getId());
            if ($saved === null) {
                $current = $zines->revision($id) ?? throw new ZineRejected('not_found', 'No such zine.');
                throw new ZineRejected('conflict', 'Someone else changed this zine.', ['revision' => $current]);
            }
            $this->response->json(['ok' => true, 'revision' => $saved]);
        });
    }

    public function upload(): void
    {
        $this->json(function () {
            $this->checkReusableCSRFParam();
            $zine = $this->zineFor('upload');
            $file = $this->request->getFileInfo('image');
            $error = $file['error'] ?? null;
            if ($error === UPLOAD_ERR_INI_SIZE || $error === UPLOAD_ERR_FORM_SIZE) {
                throw new ZineRejected('too_large', 'An image must be at most 10 MB.');
            }
            if ($error !== UPLOAD_ERR_OK || ! is_file($file['tmp_name'] ?? '')) {
                throw new ZineRejected('bad_request', 'Choose an image to upload.');
            }
            if (filesize($file['tmp_name']) > ZineImages::MAX_BYTES) {
                throw new ZineRejected('too_large', 'An image must be at most 10 MB.');
            }
            $stored = (new ZineImages($this->container))->store(
                (int) $zine['project_id'],
                (string) file_get_contents($file['tmp_name']),
                'hotdogpress-'.$zine['id'].'-'.ZineModel::randomId(8),
            );
            $this->response->json(['ok' => true] + $stored);
        });
    }

    public function image(): void
    {
        $this->json(function () {
            $zine = $this->zineFor('image');
            $image = (new ZineImages($this->container))->read((int) $zine['project_id'], $this->request->getIntegerParam('file_id'));
            if ($image === null) {
                throw new ZineRejected('not_found', 'No such image.');
            }
            foreach (headers_sent() ? [] : self::DROPPED_HEADERS as $header) {
                header_remove($header);
            }
            $this->response
                ->withContentType($image['mime'])
                ->withHeader('X-Content-Type-Options', 'nosniff')
                ->withHeader('Content-Security-Policy', "default-src 'none'; sandbox")
                ->withHeader('Content-Disposition', 'inline; filename="'.self::asciiName($image['name']).'"')
                ->withHeader('Cache-Control', 'private, max-age='.self::IMAGE_CACHE_SECONDS)
                ->withBody($image['bytes'])
                ->send();
        });
    }

    /** The name with anything but ASCII letters, digits, dot, dash and underscore replaced; never empty. */
    private static function asciiName(string $name): string
    {
        $safe = trim((string) preg_replace('/[^A-Za-z0-9._-]+/', '_', $name), '._');
        return substr($safe === '' ? 'image' : $safe, 0, 100);
    }
}
