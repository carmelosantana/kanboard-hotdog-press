<?php
require_once 'tests/units/Base.php';
require_once __DIR__.'/ZineHarness.php';

use KanboardTests\units\Base;
use Kanboard\Plugin\HotDogPress\Controller\ZineApiController;
use Kanboard\Plugin\HotDogPress\Model\DogValidator;
use Kanboard\Plugin\HotDogPress\Model\ZineImages;

// The editor's JSON API. Each test names the ZineApiController mutation it kills.
class ZineApiControllerTest extends Base
{
    use ZineHarness;

    private int $zine;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpZines();
        $this->zine = $this->makeZine();
    }

    protected function tearDown(): void
    {
        $this->tearDownZines();
        parent::tearDown();
    }

    private function api(string $action, array $get = [], ?array $post = null, array $files = []): array
    {
        return $this->call(ZineApiController::class, $action, $get + ['zine_id' => (string) $this->zine], $post, $files);
    }

    private function save(array $post): array
    {
        return $this->api('save', [], $post + ['csrf_token' => $this->reusable()]);
    }

    private function uploadImage(string $bytes, string $name = 'photo.png'): array
    {
        return $this->api('upload', [], ['csrf_token' => $this->reusable()], ['image' => $this->upload($bytes, $name)]);
    }

    // Kills: re-encoding the stored document (assets {} would come back as []), or a wrong can_edit.
    public function testLoadReturnsTheDocumentVerbatim(): void
    {
        $this->loginAs('viewer');
        $out = $this->api('load');

        $this->assertSame(200, $out['status']);
        $this->assertSame('application/json', $out['headers']['Content-Type']);
        $this->assertStringContainsString('"document":'.$this->dogJson().'}', $out['body']);
        $this->assertSame(
            ['id' => $this->zine, 'project_id' => $this->project, 'title' => 'First issue', 'revision' => 1, 'can_edit' => false],
            array_diff_key($out['json'], ['document' => 1]),
        );
        $this->loginAs('member');
        $this->assertTrue($this->api('load')['json']['can_edit']);
    }

    // Kills: telling an outsider that a zine exists (403 instead of the same 404 as a missing id).
    public function testAnotherProjectsZineIs404LikeAMissingOne(): void
    {
        $this->loginAs('outsider');
        $theirs = $this->api('load');
        $missing = $this->call(ZineApiController::class, 'load', ['zine_id' => '999']);

        $this->assertJsonError($theirs, 404, 'not_found');
        $this->assertSame($missing['body'], $theirs['body']);
        // A project_id the outsider manages does not lend its role to this zine.
        $this->assertJsonError($this->api('save', ['project_id' => (string) $this->otherProject], ['revision' => '1', 'document' => $this->dogJson(), 'csrf_token' => $this->reusable()]), 404, 'not_found');
        $this->assertJsonError($this->api('image', ['file_id' => '1']), 404, 'not_found');
    }

    // Kills: a save without the revision check, without bumping it, or storing a re-encoded document.
    public function testSaveBumpsTheRevision(): void
    {
        $this->loginAs('member');
        $doc = $this->dogJson('valid-full');

        $out = $this->save(['revision' => '1', 'document' => $doc]);

        $this->assertSame(['ok' => true, 'revision' => 2], $out['json']);
        $this->assertSame($doc, $this->zines()->getById($this->zine)['document']);
        $this->assertSame('Plant Medicine', $this->zines()->getById($this->zine)['title']);
    }

    // Kills: overwriting a newer revision, or a 409 without the current revision for the conflict prompt.
    public function testStaleRevisionIs409WithTheCurrentRevision(): void
    {
        $this->loginAs('member');
        $this->save(['revision' => '1', 'document' => $this->dogJson('valid-minimal', ['title' => 'Tab one'])]);

        $out = $this->save(['revision' => '1', 'document' => $this->dogJson('valid-minimal', ['title' => 'Tab two'])]);

        $this->assertJsonError($out, 409, 'conflict');
        $this->assertSame(2, $out['json']['revision']);
        $this->assertSame('Tab one', $this->zines()->getById($this->zine)['title']);
    }

    // Kills: letting a project viewer write.
    public function testViewerCannotSaveOrUpload(): void
    {
        $this->loginAs('viewer');

        $this->assertJsonError($this->save(['revision' => '1', 'document' => $this->dogJson('valid-full')]), 403, 'forbidden');
        $this->assertJsonError($this->uploadImage(self::png()), 403, 'forbidden');
        $this->assertSame(1, $this->zines()->revision($this->zine));
        $this->assertSame([], $this->container['projectFileModel']->getAll($this->project));
    }

    // Kills: skipping checkReusableCSRFParam on save or upload.
    public function testWritesNeedTheCsrfToken(): void
    {
        $this->loginAs('member');

        $this->assertJsonError($this->api('save', [], ['revision' => '1', 'document' => $this->dogJson()]), 403, 'forbidden');
        $this->assertJsonError($this->save(['revision' => '1', 'document' => $this->dogJson(), 'csrf_token' => 'nope']), 403, 'forbidden');
        $this->assertJsonError($this->api('upload', [], ['csrf_token' => 'nope'], ['image' => $this->upload(self::png())]), 403, 'forbidden');
        $this->assertSame(1, $this->zines()->revision($this->zine));
        $this->assertSame([], $this->container['projectFileModel']->getAll($this->project));
    }

    // Kills: decoding an oversize body before refusing it (the cap is on the raw text), or a wrong status.
    public function testOversizeDocumentIs413BeforeDecoding(): void
    {
        $this->loginAs('member');

        $out = $this->save(['revision' => '1', 'document' => '{'.str_repeat(' ', DogValidator::MAX_BYTES)]);

        $this->assertJsonError($out, 413, 'too_large');
    }

    // Kills: saving a Dog that fails strict validation, or hiding the errors from the editor.
    public function testInvalidDocumentIs422WithErrors(): void
    {
        $this->loginAs('member');

        $out = $this->save(['revision' => '1', 'document' => $this->dogJson('valid-minimal', ['paper' => 'a3'])]);

        $this->assertJsonError($out, 422, 'invalid');
        $this->assertSame([['path' => 'paper', 'message' => 'must be one of a4, letter']], $out['json']['errors']);
        $this->assertJsonError($this->save(['revision' => '1', 'document' => '[]']), 400, 'bad_request');
        $this->assertJsonError($this->save(['revision' => 'x', 'document' => $this->dogJson()]), 400, 'bad_request');
        $this->assertJsonError($this->save(['revision' => '1']), 400, 'bad_request');
        $this->assertSame(1, $this->zines()->revision($this->zine));
    }

    // Kills: an upload that is not a project file of the zine's project, or that loses the size and type.
    public function testUploadStoresImagesAsProjectFiles(): void
    {
        $this->loginAs('member');
        foreach ([[self::png(40, 30), 'image/png', 40, 30], [self::jpeg(30, 20), 'image/jpeg', 30, 20], [self::webp(12, 8), 'image/webp', 12, 8]] as [$bytes, $mime, $w, $h]) {
            $out = $this->uploadImage($bytes, 'any-name.bin');

            $this->assertSame(200, $out['status'], $out['body']);
            $this->assertTrue($out['json']['ok']);
            $this->assertSame(['mime' => $mime, 'w' => $w, 'h' => $h], array_intersect_key($out['json'], ['mime' => 1, 'w' => 1, 'h' => 1]));
            $file = $this->container['projectFileModel']->getById($out['json']['file_id']);
            $this->assertSame($this->project, (int) $file['project_id']);
            $this->assertSame($bytes, $this->container['objectStorage']->get($file['path']));
            $this->assertStringEndsWith('.'.ZineImages::TYPES[$mime], $file['name'], 'the extension follows the sniffed type');
        }
    }

    // Kills: trusting the file name or the client's type; storing GIF, SVG, HTML or empty files.
    public function testNonImagesAreRejected(): void
    {
        $this->loginAs('member');
        foreach ([self::gif(), '<svg xmlns="http://www.w3.org/2000/svg"/>', "<!DOCTYPE html><script>alert(1)</script>", "\x89PNG\r\n\x1a\nnot really"] as $bytes) {
            $this->assertJsonError($this->uploadImage($bytes, 'photo.png'), 415, 'unsupported');
        }
        $this->assertJsonError($this->api('upload', [], ['csrf_token' => $this->reusable()]), 400, 'bad_request');
        $this->assertJsonError($this->api('upload', [], ['csrf_token' => $this->reusable()], ['image' => $this->upload('', 'a.png', UPLOAD_ERR_INI_SIZE)]), 413, 'too_large');
        $this->assertSame([], $this->container['projectFileModel']->getAll($this->project));
    }

    // Kills: a missing or off-by-one 10 MB cap.
    public function testUploadOverTenMegabytesIs413(): void
    {
        $this->loginAs('member');
        $big = self::png();
        $big .= str_repeat("\0", ZineImages::MAX_BYTES + 1 - strlen($big));

        $this->assertJsonError($this->uploadImage($big), 413, 'too_large');
        $this->assertSame([], $this->container['projectFileModel']->getAll($this->project));
        $this->assertSame(200, $this->uploadImage(substr($big, 0, ZineImages::MAX_BYTES))['status'], 'exactly 10 MB is fine');
    }

    // Kills: serving with the stored name's type, without nosniff, or without private caching.
    public function testImageServesTheProjectFileWithLockedDownHeaders(): void
    {
        $this->loginAs('member');
        $png = self::png();
        $fileId = $this->uploadImage($png)['json']['file_id'];
        $this->loginAs('viewer');

        $out = $this->api('image', ['file_id' => (string) $fileId]);

        $this->assertSame(200, $out['status']);
        $this->assertSame($png, $out['body']);
        $this->assertSame('image/png', $out['headers']['Content-Type']);
        $this->assertSame('nosniff', $out['headers']['X-Content-Type-Options']);
        $this->assertSame("default-src 'none'; sandbox", $out['headers']['Content-Security-Policy']);
        $this->assertSame('private, max-age='.ZineApiController::IMAGE_CACHE_SECONDS, $out['headers']['Cache-Control']);
        $this->assertMatchesRegularExpression('~^inline; filename="[A-Za-z0-9._-]+"$~', $out['headers']['Content-Disposition']);
    }

    // Kills: serving another project's file through this zine, or a non-image project file.
    public function testImageServesOnlyImagesOfTheZinesProject(): void
    {
        $theirs = $this->container['projectFileModel']->uploadContent($this->otherProject, 'x.png', self::png(), false);
        // Named and flagged as an image, but text: the endpoint sniffs the bytes.
        $notes = 'just text';
        $this->container['objectStorage']->put('projects/'.$this->project.'/notes', $notes);
        $text = $this->container['projectFileModel']->create($this->project, 'notes.png', 'projects/'.$this->project.'/notes', 9);
        $this->loginAs('viewer');

        $this->assertJsonError($this->api('image', ['file_id' => (string) $theirs]), 404, 'not_found');
        $this->assertJsonError($this->api('image', ['file_id' => (string) $text]), 404, 'not_found');
        $this->assertJsonError($this->api('image', ['file_id' => '999']), 404, 'not_found');
    }
}
