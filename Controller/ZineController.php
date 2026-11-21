<?php
namespace Kanboard\Plugin\HotDogPress\Controller;

use Kanboard\Controller\BaseController;
use Kanboard\Plugin\HotDogPress\Model\HotdogFile;
use Kanboard\Plugin\HotDogPress\Model\ZineModel;
use Kanboard\Plugin\HotDogPress\Model\ZineRejected;

/**
 * Zine pages and form actions. Project-scoped: index (list), create, import (.hotdog). Zine-scoped: editor,
 * rename, confirm + remove, export (.hotdog). Roles come from the access map in Plugin.php via ZineAccess.
 *
 * Mustard (.mustard.md) never reaches the server: the browser compiles it and posts the Dog to create (with
 * `document`) or to the API's save, and exports it itself.
 */
class ZineController extends BaseController
{
    use ZineAccess;

    public function index(): void
    {
        $project = $this->projectFor('index');
        $this->response->html($this->helper->layout->project('HotDogPress:zine/list', [
            'title' => t('Zines'),
            'project' => $project,
            'zines' => $this->zines()->getAllByProject((int) $project['id']),
            'can_create' => $this->can('ZineController', 'create', (int) $project['id']),
        ]));
    }

    public function editor(): void
    {
        $zine = $this->zineFor('editor');
        $this->response->html($this->helper->layout->project('HotDogPress:zine/editor', [
            'title' => $zine['title'],
            'project' => $this->projectModel->getById((int) $zine['project_id']),
            'zine' => $zine,
            'can_edit' => $this->can('ZineApiController', 'save', (int) $zine['project_id']),
        ]));
    }

    /** POST title, and optionally document (a Dog the browser compiled from Mustard); opens the editor. */
    public function create(): void
    {
        $this->checkCSRFForm();
        $project = $this->projectFor('create');
        $title = (string) $this->request->getRawValue('title');
        $document = $this->request->getRawValue('document');
        try {
            if (is_string($document) && $document !== '') {
                $dog = $this->zines()->document($document);
                $title = trim($title) === '' && is_string($dog['title'] ?? null) ? $dog['title'] : $title;
            } else {
                $document = ZineModel::blankDocument($title);
            }
        } catch (ZineRejected $e) {
            $this->flash->failure(t($e->getMessage()));
            $this->toList((int) $project['id']);
            return;
        }
        $id = $this->zines()->create((int) $project['id'], $title, $document, (int) $this->userSession->getId());
        $this->toEditor($id);
    }

    public function rename(): void
    {
        $this->checkCSRFForm();
        $zine = $this->zineFor('rename');
        if ($this->zines()->rename((int) $zine['id'], (string) $this->request->getRawValue('title'), (int) $this->userSession->getId())) {
            $this->flash->success(t('Zine renamed.'));
        } else {
            $this->flash->failure(t('The zine changed while renaming it, try again.'));
        }
        $this->toList((int) $zine['project_id']);
    }

    public function confirm(): void
    {
        $zine = $this->zineFor('confirm');
        $this->response->html($this->template->render('HotDogPress:zine/remove', ['zine' => $zine]));
    }

    public function remove(): void
    {
        $this->checkCSRFParam();
        $zine = $this->zineFor('remove');
        if ($this->zines()->remove((int) $zine['id'])) {
            $this->flash->success(t('Zine removed.'));
        } else {
            $this->flash->failure(t('Unable to remove this zine.'));
        }
        $this->toList((int) $zine['project_id']);
    }

    /** The zine as a portable .hotdog download, images inlined. */
    public function export(): void
    {
        $zine = $this->zineFor('export');
        $this->response
            ->withFileDownload(self::slug($zine['title']).'.hotdog')
            ->withContentType('application/json')
            ->withHeader('X-Content-Type-Options', 'nosniff')
            ->withoutCache()
            ->withBody((new HotdogFile($this->container))->export($zine))
            ->send();
    }

    /** POST a .hotdog file (multipart field `file`) as a new zine; opens it in the editor. */
    public function import(): void
    {
        $this->checkCSRFForm();
        $project = $this->projectFor('import');
        $file = $this->request->getFileInfo('file');
        try {
            $error = $file['error'] ?? null;
            if ($error === UPLOAD_ERR_INI_SIZE || $error === UPLOAD_ERR_FORM_SIZE
                || ($error === UPLOAD_ERR_OK && filesize($file['tmp_name']) > HotdogFile::MAX_BYTES)) {
                throw new ZineRejected('too_large', 'A .hotdog file must be at most 16 MB.');
            }
            if ($error !== UPLOAD_ERR_OK || ! is_file($file['tmp_name'] ?? '')) {
                throw new ZineRejected('bad_request', 'Choose a .hotdog file to import.');
            }
            $id = (new HotdogFile($this->container))->import(
                (string) file_get_contents($file['tmp_name']),
                (int) $project['id'],
                (int) $this->userSession->getId(),
            );
        } catch (ZineRejected $e) {
            $this->flash->failure(t($e->getMessage()));
            $this->toList((int) $project['id']);
            return;
        }
        $this->toEditor($id);
    }

    /**
     * A file name from the title: lowercase ASCII letters and digits joined by dashes; "zine" when none are left.
     * No iconv transliteration: musl's (the Alpine image) turns accents into "?".
     */
    public static function slug(string $title): string
    {
        $slug = trim((string) preg_replace('/[^a-z0-9]+/', '-', strtolower($title)), '-');
        return $slug === '' ? 'zine' : substr($slug, 0, 80);
    }

    private function zines(): ZineModel
    {
        return new ZineModel($this->container);
    }

    private function toList(int $projectId): void
    {
        $this->response->redirect($this->helper->url->to('ZineController', 'index', ['plugin' => 'HotDogPress', 'project_id' => $projectId]));
    }

    private function toEditor(int $id): void
    {
        $this->response->redirect($this->helper->url->to('ZineController', 'editor', ['plugin' => 'HotDogPress', 'zine_id' => $id]));
    }
}
