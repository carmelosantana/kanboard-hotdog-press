<?php
require_once 'tests/units/Base.php';
require_once __DIR__.'/ZineHarness.php';

use KanboardTests\units\Base;

// The project access map from Plugin.php, asked the way core's middleware and the controllers ask it.
class PermissionsTest extends Base
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

    // Lowest project role per action: viewers read and export, members write, managers delete.
    private const MATRIX = [
        ['ZineController', 'index', 'viewer'],
        ['ZineController', 'editor', 'viewer'],
        ['ZineController', 'export', 'viewer'],
        ['ZineApiController', 'load', 'viewer'],
        ['ZineApiController', 'image', 'viewer'],
        ['ZineController', 'create', 'member'],
        ['ZineController', 'rename', 'member'],
        ['ZineController', 'import', 'member'],
        ['ZineApiController', 'save', 'member'],
        ['ZineApiController', 'upload', 'member'],
        ['ZineApiController', 'pdf', 'member'],
        ['ZineController', 'confirm', 'manager'],
        ['ZineController', 'remove', 'manager'],
    ];

    // Kills: a missing or wrong-role access map entry; any action open to a user outside the project.
    public function testRoleMatrix(): void
    {
        $rank = ['outsider' => 0, 'viewer' => 1, 'member' => 2, 'manager' => 3];
        foreach (['outsider', 'viewer', 'member', 'manager'] as $user) {
            $this->loginAs($user);
            foreach (self::MATRIX as [$controller, $action, $lowest]) {
                $this->assertSame(
                    $rank[$user] >= $rank[$lowest],
                    $this->container['helper']->user->hasProjectAccess($controller, $action, $this->project),
                    "$user on $controller::$action",
                );
            }
        }
    }
}
