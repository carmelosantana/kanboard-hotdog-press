<?php
require_once 'tests/units/Base.php';

use KanboardTests\units\Base;
use Kanboard\Plugin\HotDogPress\Plugin;

// Route strings are frozen: the templates (Task 10) and the editor (Tasks 11-12) build URLs from them.
class RoutesTest extends Base
{
    public const ROUTES = [
        'hotdogpress/project/7' => ['ZineController', 'index', ['project_id' => 7]],
        'hotdogpress/project/7/create' => ['ZineController', 'create', ['project_id' => 7]],
        'hotdogpress/project/7/import' => ['ZineController', 'import', ['project_id' => 7]],
        'hotdogpress/zine/3' => ['ZineController', 'editor', ['zine_id' => 3]],
        'hotdogpress/zine/3/rename' => ['ZineController', 'rename', ['zine_id' => 3]],
        'hotdogpress/zine/3/confirm' => ['ZineController', 'confirm', ['zine_id' => 3]],
        'hotdogpress/zine/3/remove' => ['ZineController', 'remove', ['zine_id' => 3]],
        'hotdogpress/zine/3/export' => ['ZineController', 'export', ['zine_id' => 3]],
        'hotdogpress/zine/3/load' => ['ZineApiController', 'load', ['zine_id' => 3]],
        'hotdogpress/zine/3/save' => ['ZineApiController', 'save', ['zine_id' => 3]],
        'hotdogpress/zine/3/upload' => ['ZineApiController', 'upload', ['zine_id' => 3]],
        'hotdogpress/zine/3/image/12' => ['ZineApiController', 'image', ['zine_id' => 3, 'file_id' => 12]],
        'hotdogpress/mine' => ['MyZinesController', 'index', []],
    ];

    // Kills: renaming a route, or wiring it to the wrong controller action.
    public function testRoutes(): void
    {
        $route = $this->container['route'];
        $route->enable();
        (new Plugin($this->container))->initialize();

        foreach (self::ROUTES as $path => [$controller, $action, $params]) {
            $this->assertSame(['controller' => $controller, 'action' => $action, 'plugin' => 'HotDogPress'], $route->findRoute($path), $path);
            $this->assertSame($path, $route->findUrl($controller, $action, $params, 'HotDogPress'), "$controller::$action");
        }
    }
}
