<?php
require_once 'tests/units/Base.php';
require_once __DIR__.'/ZineHarness.php';

use KanboardTests\units\Base;
use Kanboard\Core\Controller\AccessForbiddenException;
use Kanboard\Core\Controller\PageNotFoundException;
use Kanboard\Plugin\HotDogPress\Controller\MyZinesController;
use Kanboard\Plugin\HotDogPress\Controller\ZineController;
use Kanboard\Plugin\HotDogPress\Model\DogValidator;
use Kanboard\Plugin\HotDogPress\Model\HotdogFile;
use Kanboard\Plugin\HotDogPress\Model\ZineImages;
use Kanboard\Plugin\HotDogPress\Model\ZineModel;

// The page controller: list, editor, create, rename, delete, .hotdog export and import. Each test names the
// mutation it kills.
class ZineControllerTest extends Base
{
    use ZineHarness;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpZines();
    }

    protected function tearDown(): void
    {
        $this->tearDownZines();
        parent::tearDown();
    }

    private function page(string $action, array $get = [], ?array $post = null, array $files = []): array
    {
        return $this->call(ZineController::class, $action, $get, $post, $files);
    }

    private function onProject(string $action, array $post, array $files = []): array
    {
        return $this->page($action, ['project_id' => (string) $this->project], $post + ['csrf_token' => $this->formToken()], $files);
    }

    private function onZine(string $action, int $zine, ?array $post = null, array $get = []): array
    {
        if ($post !== null) {
            $post += ['csrf_token' => $this->formToken()];
        }
        return $this->page($action, $get + ['zine_id' => (string) $zine], $post);
    }

    private function zineCount(): int
    {
        return $this->container['db']->table(ZineModel::TABLE)->count();
    }

    private function editorUrl(int $id): string
    {
        return $this->container['helper']->url->to('ZineController', 'editor', ['plugin' => 'HotDogPress', 'zine_id' => $id]);
    }

    private function listUrl(): string
    {
        return $this->container['helper']->url->to('ZineController', 'index', ['plugin' => 'HotDogPress', 'project_id' => $this->project]);
    }

    private function assertThrowsFor(string $exception, callable $fn): void
    {
        try {
            $fn();
            $this->fail("expected $exception");
        } catch (Throwable $e) {
            $this->assertInstanceOf($exception, $e);
        }
    }

    private function lastFlash(string $type): ?string
    {
        return $this->container['flash']->getMessage($type) ?: null;
    }

    // Kills: a create outside the member role, without the form token, or that does not open the editor.
    public function testMemberCreatesABlankZine(): void
    {
        $this->loginAs('member');
        $out = $this->onProject('create', ['title' => 'Elderberries']);

        $zine = $this->container['db']->table(ZineModel::TABLE)->findOne();
        $this->assertSame($this->editorUrl((int) $zine['id']), $out['headers']['Location']);
        $this->assertSame('Elderberries', $zine['title']);
        $this->assertTrue(DogValidator::validate(json_decode($zine['document'], true), 'strict')['ok']);

        $this->assertThrowsFor(AccessForbiddenException::class, fn () => $this->onProject('create', ['csrf_token' => 'nope']));
        $this->loginAs('viewer');
        $this->assertThrowsFor(AccessForbiddenException::class, fn () => $this->onProject('create', ['title' => 'x']));
        $this->loginAs('outsider');
        $this->assertThrowsFor(PageNotFoundException::class, fn () => $this->onProject('create', ['title' => 'x']));
        $this->assertSame(1, $this->zineCount());
    }

    // Kills: a create that takes a Dog from the client (create makes blank zines; Mustard reaches the server only as a
    // save from the editor, and .hotdog files through import).
    public function testCreateIgnoresAPostedDocument(): void
    {
        $this->loginAs('member');
        $this->onProject('create', ['title' => 'Blank', 'document' => $this->dogJson('valid-full')]);
        $zine = $this->container['db']->table(ZineModel::TABLE)->findOne();
        $this->assertSame('Blank', $zine['title']);
        $dog = json_decode($zine['document'], true);
        $this->assertSame([], array_merge(...array_column($dog['pages'], 'items')), 'eight empty pages');
    }

    // Kills: a rename open to viewers, or one that does not reach the model.
    public function testMemberRenames(): void
    {
        $id = $this->makeZine();
        $this->loginAs('viewer');
        $this->assertThrowsFor(AccessForbiddenException::class, fn () => $this->onZine('rename', $id, ['title' => 'Nope']));

        $this->loginAs('member');
        $out = $this->onZine('rename', $id, ['title' => 'Second issue']);

        $this->assertSame($this->listUrl(), $out['headers']['Location']);
        $this->assertSame('Second issue', $this->zines()->getById($id)['title']);
    }

    // Kills: a delete open to members, or one without the URL token.
    public function testOnlyManagersDelete(): void
    {
        $id = $this->makeZine();
        $this->loginAs('member');
        $this->assertThrowsFor(AccessForbiddenException::class, fn () => $this->onZine('confirm', $id));
        $this->assertThrowsFor(AccessForbiddenException::class, fn () => $this->onZine('remove', $id, null, ['csrf_token' => $this->formToken()]));

        $this->loginAs('manager');
        $this->assertStringContainsString('First issue', $this->onZine('confirm', $id)['body']);
        $this->assertThrowsFor(AccessForbiddenException::class, fn () => $this->onZine('remove', $id, null, ['csrf_token' => 'nope']));
        $this->assertNotNull($this->zines()->getById($id));

        $out = $this->onZine('remove', $id, null, ['csrf_token' => $this->formToken()]);
        $this->assertSame($this->listUrl(), $out['headers']['Location']);
        $this->assertNull($this->zines()->getById($id));
    }

    // Kills: listing another project's zines, unescaped titles, or an editor page for an outsider.
    public function testListAndEditorPages(): void
    {
        $id = $this->makeZine(null, '<b>Bold</b> issue');
        $this->makeZine($this->otherProject, 'Elsewhere');
        $this->loginAs('viewer');

        $list = $this->page('index', ['project_id' => (string) $this->project])['body'];
        $this->assertStringContainsString('&lt;b&gt;Bold&lt;/b&gt; issue', $list);
        $this->assertStringNotContainsString('<b>Bold</b>', $list);
        $this->assertStringNotContainsString('Elsewhere', $list);
        $this->assertStringContainsString('&lt;b&gt;Bold&lt;/b&gt; issue', $this->onZine('editor', $id)['body']);

        $this->loginAs('outsider');
        $this->assertThrowsFor(PageNotFoundException::class, fn () => $this->onZine('editor', $id));
        $this->assertThrowsFor(PageNotFoundException::class, fn () => $this->onZine('export', $id));
    }

    // Kills: an export that keeps file_id (not portable), leaks another project's file, carries a photo no item uses
    // (one replaced or deleted before the editor pruned them), or is not a download.
    public function testExportInlinesImagesAsDataUrls(): void
    {
        $png = self::png();
        $mine = (new ZineImages($this->container))->store($this->project, $png, 'p')['file_id'];
        $theirs = (new ZineImages($this->container))->store($this->otherProject, self::png(8, 8), 't')['file_id'];
        $dog = $this->dog('valid-full');
        $dog['assets']['a1']['file_id'] = $mine;
        $dog['assets']['a2'] = ['kind' => 'image', 'file_id' => $theirs, 'name' => 'x.png'];
        $dog['pages'][1]['items'][] = ['id' => 'i_theirs', 'type' => 'image', 'by' => 'hand', 'x' => 0, 'y' => 0, 'w' => 1, 'h' => 1, 'asset' => 'a2'];
        $dog['assets']['old'] = ['kind' => 'image', 'file_id' => $mine, 'name' => 'replaced.png'];
        $id = $this->zines()->create($this->project, 'Plant Medicine: Vol 1', json_encode($dog, JSON_UNESCAPED_SLASHES), $this->users['member']);
        $this->loginAs('viewer');

        $out = $this->onZine('export', $id);

        $this->assertSame('attachment; filename="plant-medicine-vol-1.hotdog"', $out['headers']['Content-Disposition']);
        $this->assertSame('application/json', $out['headers']['Content-Type']);
        $this->assertStringContainsString("\n    ", $out['body'], 'pretty-printed');
        $assets = $out['json']['assets'];
        $this->assertSame(ZineImages::dataUrl('image/png', $png), $assets['a1']['data']);
        $this->assertArrayNotHasKey('file_id', $assets['a1']);
        $this->assertSame(['kind' => 'placeholder', 'name' => 'x.png'], $assets['a2'], 'another project\'s file is not inlined');
        $this->assertSame($dog['assets']['s1'], $assets['s1'], 'a data asset is kept as is');
        $this->assertSame(['a1', 's1', 'a2'], array_keys($assets), 'an asset no item uses is left out');
        $this->assertTrue(DogValidator::validate($out['json'], 'strict')['ok']);
    }

    // Kills: an import that keeps data URLs in the stored Dog, stores images in another project, or re-encodes
    // empty objects as [].
    public function testImportWritesInlineImagesAsProjectFiles(): void
    {
        $png = self::png();
        $dog = $this->dog('valid-full');
        $dog['assets']['a1'] = ['kind' => 'image', 'data' => ZineImages::dataUrl('image/jpeg', $png), 'w' => 40, 'h' => 30];
        unset($dog['assets']['s1']);
        foreach ($dog['pages'] as &$page) {
            $page['items'] = array_values(array_filter($page['items'], fn ($i) => ($i['asset'] ?? '') !== 's1'));
        }
        unset($page);
        $dog['pages'][1]['items'][] = ['id' => 'tx9', 'type' => 'text', 'x' => 0, 'y' => 0, 'w' => 1, 'h' => 1, 'by' => 'hand', 'attrs' => new stdClass(), 'runs' => [['text' => 'hi']]];
        $this->loginAs('member');

        $out = $this->onProject('import', [], ['file' => $this->upload(json_encode($dog, JSON_PRETTY_PRINT), 'plant.hotdog')]);

        $zine = $this->container['db']->table(ZineModel::TABLE)->findOne();
        $this->assertNotNull($zine, (string) $this->lastFlash('failure'));
        $this->assertSame($this->editorUrl((int) $zine['id']), $out['headers']['Location']);
        $this->assertSame($this->project, (int) $zine['project_id']);
        $this->assertSame('Plant Medicine', $zine['title']);
        $stored = json_decode($zine['document'], true);
        $this->assertArrayNotHasKey('data', $stored['assets']['a1']);
        $file = $this->container['projectFileModel']->getById($stored['assets']['a1']['file_id']);
        $this->assertSame($this->project, (int) $file['project_id']);
        $this->assertSame($png, $this->container['objectStorage']->get($file['path']));
        $this->assertStringContainsString('"attrs":{}', $zine['document']);
        $this->assertTrue(DogValidator::validate($stored, 'strict')['ok']);
    }

    // Kills: an import that writes files before the Dog is known to be good, accepts non-image data, skips the
    // strict check (unknown fields), or the file size cap.
    public function testBadImportsWriteNothing(): void
    {
        $this->loginAs('member');
        $image = ['kind' => 'image', 'data' => ZineImages::dataUrl('image/png', self::png())];
        $cases = [
            'not json' => '{nope',
            'svg data' => json_encode($this->dog('valid-minimal', ['assets' => ['a1' => ['kind' => 'image', 'data' => 'data:image/svg+xml;base64,'.base64_encode('<svg/>')]]])),
            'bad dog' => json_encode($this->dog('valid-minimal', ['paper' => 'a3', 'assets' => ['a1' => $image]])),
            'unknown field' => json_encode($this->dog('valid-minimal', ['extra' => true, 'assets' => ['a1' => $image]])),
            'assets array' => str_replace('"assets":{}', '"assets":[]', json_encode($this->dog('valid-minimal', ['assets' => new \stdClass()]))),
            'too large' => '{'.str_repeat(' ', HotdogFile::MAX_BYTES),
        ];
        foreach ($cases as $case => $text) {
            $this->onProject('import', [], ['file' => $this->upload($text, 'x.hotdog')]);
            $this->assertNotNull($this->lastFlash('failure'), $case);
            $this->assertSame(0, $this->zineCount(), $case);
            $this->assertSame([], $this->container['projectFileModel']->getAll($this->project), $case);
        }
        $this->loginAs('viewer');
        $this->assertThrowsFor(AccessForbiddenException::class, fn () => $this->onProject('import', [], ['file' => $this->upload('{}')]));
    }

    // Kills: an import that decodes, sniffs and keeps every inline image before the asset cap is checked.
    public function testImportRejectsTooManyAssetsBeforeAnyImageWork(): void
    {
        $garbage = ['kind' => 'image', 'data' => 'data:image/png;base64,!!not-an-image!!'];
        $assets = [];
        for ($i = 0; $i <= DogValidator::MAX_ASSETS; $i++) {
            $assets['a'.$i] = $garbage;
        }
        $file = new HotdogFile($this->container);
        try {
            $file->import(json_encode($this->dog('valid-minimal', ['assets' => $assets])), $this->project, $this->users['member']);
            $this->fail('expected a rejection');
        } catch (\Kanboard\Plugin\HotDogPress\Model\ZineRejected $e) {
            $this->assertSame('invalid', $e->code);
            $this->assertStringContainsString('at most 500 assets', $e->getMessage());
        }
        $this->assertSame(0, $this->zineCount());
    }

    // Kills: a cap that is off by one (exactly the maximum must go on to normal validation, here a bad image).
    public function testImportAtTheAssetCapStillValidatesNormally(): void
    {
        $assets = [];
        for ($i = 0; $i < DogValidator::MAX_ASSETS; $i++) {
            $assets['a'.$i] = ['kind' => 'image', 'data' => 'data:image/png;base64,!!not-an-image!!'];
        }
        try {
            (new HotdogFile($this->container))->import(json_encode($this->dog('valid-minimal', ['assets' => $assets])), $this->project, $this->users['member']);
            $this->fail('expected a rejection');
        } catch (\Kanboard\Plugin\HotDogPress\Model\ZineRejected $e) {
            $this->assertSame('unsupported', $e->code);
        }
    }

    // Kills: an export → import round trip that loses an image or changes the pages.
    public function testExportImportRoundTrip(): void
    {
        $png = self::png();
        $fileId = (new ZineImages($this->container))->store($this->project, $png, 'p')['file_id'];
        $dog = $this->dog('valid-full');
        $dog['assets']['a1']['file_id'] = $fileId;
        $id = $this->zines()->create($this->project, 'x', json_encode($dog, JSON_UNESCAPED_SLASHES), $this->users['member']);
        $this->loginAs('member');

        $exported = $this->onZine('export', $id)['body'];
        $this->onProject('import', [], ['file' => $this->upload($exported, 'x.hotdog')]);

        $copy = $this->container['db']->table(ZineModel::TABLE)->neq('id', $id)->findOne();
        $this->assertNotNull($copy, (string) $this->lastFlash('failure'));
        $copied = json_decode($copy['document'], true);
        $this->assertSame($dog['pages'], $copied['pages']);
        $this->assertNotSame($fileId, $copied['assets']['a1']['file_id'], 'a new project file');
        $newFile = $this->container['projectFileModel']->getById($copied['assets']['a1']['file_id']);
        $this->assertSame($png, $this->container['objectStorage']->get($newFile['path']));
    }

    // Kills: My zines listing projects the user is not in.
    public function testMyZinesListsTheUsersProjectsOnly(): void
    {
        $this->makeZine(null, 'Ours');
        $this->makeZine($this->otherProject, 'Theirs');
        $this->loginAs('viewer');

        $html = $this->call(MyZinesController::class, 'index')['body'];

        $this->assertStringContainsString('Ours', $html);
        $this->assertStringNotContainsString('Theirs', $html);
    }
}
