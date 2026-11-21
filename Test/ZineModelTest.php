<?php
require_once 'tests/units/Base.php';
require_once __DIR__.'/ZineHarness.php';

use KanboardTests\units\Base;
use Kanboard\Plugin\HotDogPress\Model\DogValidator;
use Kanboard\Plugin\HotDogPress\Model\ZineModel;
use Kanboard\Plugin\HotDogPress\Model\ZineRejected;

// Each test names the ZineModel mutation it kills.
class ZineModelTest extends Base
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

    // Kills: a create that drops a column, starts at another revision, or rewrites the document text.
    public function testCreateStoresTheRowAtRevisionOne(): void
    {
        $json = $this->dogJson();
        $id = $this->zines()->create($this->project, '  Plant Medicine  ', $json, $this->users['member']);

        $zine = $this->zines()->getById($id);
        $this->assertSame($this->project, (int) $zine['project_id']);
        $this->assertSame('Plant Medicine', $zine['title'], 'trimmed');
        $this->assertSame($json, $zine['document'], 'stored verbatim');
        $this->assertSame(1, (int) $zine['revision']);
        $this->assertSame($this->users['member'], (int) $zine['created_by']);
        $this->assertSame($this->users['member'], (int) $zine['updated_by']);
        $this->assertGreaterThan(0, (int) $zine['created_at']);
        $this->assertSame((int) $zine['created_at'], (int) $zine['updated_at']);
        $this->assertNull($this->zines()->getById($id + 100));
    }

    // Kills: a blank document that fails strict validation, encodes assets as [] or ignores the title.
    public function testBlankDocumentIsAStrictDogWithTheTitle(): void
    {
        $json = ZineModel::blankDocument('Elderberries');
        $dog = json_decode($json, true);

        $this->assertTrue(DogValidator::validate($dog, 'strict')['ok']);
        $this->assertSame('Elderberries', $dog['title']);
        $this->assertStringContainsString('"assets":{}', $json);
        $this->assertCount(8, $dog['pages']);
        $this->assertMatchesRegularExpression('/^z_[a-z0-9]{8}$/', $dog['id']);
    }

    // Kills: an empty or over-long title stored as given.
    public function testTitleIsNormalised(): void
    {
        $this->assertSame('Untitled', ZineModel::title("  \t "));
        $this->assertSame(255, mb_strlen(ZineModel::title(str_repeat('é', 300))));
    }

    // Kills: a save that ignores the expected revision, forgets to bump it, or bumps it on a conflict.
    public function testSaveChecksAndBumpsTheRevision(): void
    {
        $id = $this->makeZine();
        $v2 = $this->dogJson('valid-minimal', ['title' => 'Second']);

        $this->assertSame(2, $this->zines()->save($id, 1, $v2, $this->users['manager']));
        $zine = $this->zines()->getById($id);
        $this->assertSame($v2, $zine['document']);
        $this->assertSame('Second', $zine['title'], 'the column follows the Dog title');
        $this->assertSame($this->users['manager'], (int) $zine['updated_by']);

        $this->assertNull($this->zines()->save($id, 1, $this->dogJson(), $this->users['member']), 'stale revision');
        $this->assertSame(2, (int) $this->zines()->getById($id)['revision']);
        $this->assertSame($v2, $this->zines()->getById($id)['document']);
        $this->assertSame(2, $this->zines()->revision($id));
    }

    // Kills: a Dog without a usable title blanking the column.
    public function testSaveKeepsTheColumnTitleWhenTheDogHasNone(): void
    {
        $id = $this->makeZine(null, 'Kept');
        $dog = $this->dog();
        unset($dog['title']);
        $dog['assets'] = new stdClass();
        $this->zines()->save($id, 1, json_encode($dog), $this->users['member']);

        $this->assertSame('Kept', $this->zines()->getById($id)['title']);
    }

    // Kills: a rename that leaves the Dog title behind or does not bump the revision (an open editor must see it).
    public function testRenameUpdatesColumnAndDogTitle(): void
    {
        $id = $this->makeZine();

        $this->assertTrue($this->zines()->rename($id, 'Renamed', $this->users['member']));
        $zine = $this->zines()->getById($id);
        $this->assertSame('Renamed', $zine['title']);
        $this->assertSame('Renamed', json_decode($zine['document'], true)['title']);
        $this->assertStringContainsString('"assets":{}', $zine['document'], 'no {} turned into []');
        $this->assertSame(2, (int) $zine['revision']);
    }

    // Kills: listing another project's zines, or the document in a list row.
    public function testListsByProjectNewestFirstWithoutTheDocument(): void
    {
        $a = $this->makeZine(null, 'A');
        $b = $this->makeZine(null, 'B');
        $this->makeZine($this->otherProject, 'Elsewhere');
        $this->container['db']->table(ZineModel::TABLE)->eq('id', $a)->update(['updated_at' => time() + 60]);

        $rows = $this->zines()->getAllByProject($this->project);
        $this->assertSame([$a, $b], array_map(fn ($r) => (int) $r['id'], $rows));
        $this->assertArrayNotHasKey('document', $rows[0]);
    }

    // Kills: a My zines query that leaks other projects, or returns everything for a user with no projects (an
    // empty IN() is dropped by PicoDb).
    public function testMyZinesQueryCoversOnlyTheUsersProjects(): void
    {
        $mine = $this->makeZine();
        $this->makeZine($this->otherProject, 'Elsewhere');
        $loner = (int) $this->container['userModel']->create(['username' => 'loner']);

        $rows = $this->zines()->queryForUser($this->users['viewer'])->findAll();
        $this->assertSame([$mine], array_map(fn ($r) => (int) $r['id'], $rows));
        $this->assertSame('Zines', $rows[0]['project_name']);
        $this->assertArrayNotHasKey('document', $rows[0]);
        $this->assertSame([], $this->zines()->queryForUser($loner)->findAll());
    }

    // Kills: remove() that does nothing; a schema without ON DELETE CASCADE / SET NULL.
    public function testRemoveAndCascades(): void
    {
        $id = $this->makeZine();
        $this->assertTrue($this->zines()->remove($id));
        $this->assertNull($this->zines()->getById($id));

        $kept = $this->makeZine();
        $this->container['userModel']->remove($this->users['member']);
        $this->assertNull($this->zines()->getById($kept)['created_by']);

        $this->container['projectModel']->remove($this->project);
        $this->assertNull($this->zines()->getById($kept));
    }

    // Kills: decoding before the size check (the 2 MiB cap is on the raw text), or saving a Dog that is not strict.
    public function testDocumentChecksSizeJsonAndStrictRules(): void
    {
        $this->assertSame('Untitled', $this->zines()->document($this->dogJson())['title']);

        foreach ([
            ['too_large', str_repeat(' ', DogValidator::MAX_BYTES).'{}'],
            ['bad_request', '{nope'],
            ['bad_request', '[1, 2]'],
            ['invalid', $this->dogJson('valid-minimal', ['extra' => 1])],
        ] as [$code, $text]) {
            try {
                $this->zines()->document($text);
                $this->fail("accepted for $code");
            } catch (ZineRejected $e) {
                $this->assertSame($code, $e->code);
            }
        }
        try {
            $this->zines()->document($this->dogJson('valid-minimal', ['paper' => 'a3']));
        } catch (ZineRejected $e) {
            $this->assertSame([['path' => 'paper', 'message' => 'must be one of a4, letter']], $e->extra['errors']);
        }
    }

    // Kills: a file name with spaces, accents turned into "?", an empty name, or no length cap.
    public function testFileSlug(): void
    {
        $this->assertSame('plant-medicine-no-2', ZineModel::fileSlug('  Plant Medicine — No. 2!  '));
        $this->assertSame('caf-ma-ana', ZineModel::fileSlug('Café Mañana'));
        $this->assertSame('zine', ZineModel::fileSlug('¡¿…?!'));
        $this->assertSame(80, strlen(ZineModel::fileSlug(str_repeat('ab ', 60))));
    }

    // Kills: reading the Dog with json_decode(…, true), where "assets": [] passes as {} and is stored, and the editor
    // (JS validator) then refuses to open the zine.
    public function testDocumentRefusesAJsonArrayWhereDogOneHasAnObject(): void
    {
        $minimal = json_decode($this->dogJson());
        foreach ([
            'assets' => [[], [['path' => 'assets', 'message' => 'must be an object']]],
            'asset' => [(object) ['a1' => []], [['path' => 'assets/a1', 'message' => 'must be an object']]],
        ] as $case => [$assets, $errors]) {
            $minimal->assets = $assets;
            try {
                $this->zines()->document(json_encode($minimal));
                $this->fail("accepted an array as $case");
            } catch (ZineRejected $e) {
                $this->assertSame('invalid', $e->code, $case);
                $this->assertSame($errors, $e->extra['errors'], $case);
            }
        }
    }
}
