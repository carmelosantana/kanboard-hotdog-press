<?php
require_once 'tests/units/Base.php';
require_once __DIR__.'/ZineHarness.php';

use KanboardTests\units\Base;
use Kanboard\Plugin\HotDogPress\Model\EditorConfig;
use Kanboard\Plugin\HotDogPress\Controller\MyZinesController;
use Kanboard\Plugin\HotDogPress\Controller\ZineController;

// Renders the real templates and hooks: menus, the zine list and its empty state, My zines, and the editor shell
// with its JSON config. Each test names the template mutation it kills.
class TemplatesTest extends Base
{
    use ZineHarness;

    private const CSS = 'plugins/HotDogPress/Assets/css/hotdogpress.css';
    private const MAIN = 'plugins/HotDogPress/Assets/js/app/main.js';
    private const BOOT = 'plugins/HotDogPress/Assets/js/boot.js';

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

    private function hook(string $name, array $vars): string
    {
        return $this->container['helper']->hook->render($name, $vars);
    }

    private function projectVars(): array
    {
        return ['project' => $this->container['projectModel']->getById($this->project), 'filters' => ['search' => '']];
    }

    private function listPage(): string
    {
        return $this->call(ZineController::class, 'index', ['project_id' => (string) $this->project])['body'];
    }

    private function editorPage(int $id): string
    {
        return $this->call(ZineController::class, 'editor', ['zine_id' => (string) $id])['body'];
    }

    /** The editor's config block, decoded; fails if it is missing. */
    private function config(string $html): array
    {
        $this->assertSame(1, preg_match('#<script type="application/json" id="hotdogpress-config">(.*?)</script>#s', $html, $m), 'config block');
        $this->assertDoesNotMatchRegularExpression('/[<>&\']/', $m[1], 'config JSON must be HTML-safe');
        return json_decode($m[1], true, 512, JSON_THROW_ON_ERROR);
    }

    private function url(string $controller, string $action, array $params): string
    {
        return $this->container['helper']->url->to($controller, $action, ['plugin' => 'HotDogPress'] + $params);
    }

    /** No executable inline <script> (only src= or the JSON block) and no on*= handler: Kanboard's CSP blocks both. */
    private function assertCspSafe(string $html): void
    {
        $this->assertDoesNotMatchRegularExpression('/<script(?![^>]*\bsrc=)(?![^>]*type="application\/json")[^>]*>/i', $html, 'inline <script>');
        $this->assertDoesNotMatchRegularExpression('/<[^>]+\son[a-z]+\s*=/i', $html, 'on*= attribute');
    }

    // Kills: no Zines item in the project menu, a link to the wrong project, a missing Bun Sheet icon, or showing
    // the item to someone without access to the project.
    public function testProjectMenuViewSwitcherAndSidebar(): void
    {
        $this->loginAs('viewer');
        $href = $this->container['helper']->url->href('ZineController', 'index', ['plugin' => 'HotDogPress', 'project_id' => $this->project]);
        foreach (['template:project:dropdown', 'template:project-header:view-switcher', 'template:project:sidebar'] as $hook) {
            $html = $this->hook($hook, $this->projectVars());
            $this->assertStringContainsString('href="'.$href.'"', $html, $hook);
            $this->assertStringContainsString('Zines', $html, $hook);
            $this->assertStringContainsString('<svg', $html, $hook);
            $this->assertStringContainsString('#C8322B', $html, $hook.': the ketchup cut');
            $this->assertCspSafe($html);
        }

        $this->loginAs('outsider');
        foreach (['template:project:dropdown', 'template:project-header:view-switcher', 'template:project:sidebar'] as $hook) {
            $this->assertStringNotContainsString('Zines', $this->hook($hook, $this->projectVars()), $hook);
        }
    }

    // Kills: no My zines link in the dashboard sidebar, or one to the wrong page.
    public function testDashboardSidebarLink(): void
    {
        $this->loginAs('viewer');
        $html = $this->hook('template:dashboard:sidebar', ['user' => $this->container['userModel']->getById($this->users['viewer'])]);
        $this->assertStringContainsString('My zines', $html);
        $this->assertStringContainsString('href="'.$this->container['helper']->url->href('MyZinesController', 'index', ['plugin' => 'HotDogPress']).'"', $html);
    }

    // Kills: an empty state without the plain label or the flavour line, a create form shown to a viewer, or a member
    // without the create and import forms.
    public function testEmptyListForViewerAndMember(): void
    {
        $this->loginAs('viewer');
        $html = $this->listPage();
        $this->assertStringContainsString('No zines yet', $html);
        $this->assertStringContainsString('The griddle’s cold. Make your first zine.', $html);
        $this->assertStringNotContainsString(htmlspecialchars($this->url('ZineController', 'create', ['project_id' => $this->project])), $html);
        $this->assertStringNotContainsString('name="title"', $html);

        $this->loginAs('member');
        $html = $this->listPage();
        $this->assertStringContainsString('No zines yet', $html);
        $this->assertStringContainsString(htmlspecialchars($this->url('ZineController', 'create', ['project_id' => $this->project])).'"', $html);
        $this->assertStringContainsString(htmlspecialchars($this->url('ZineController', 'import', ['project_id' => $this->project])).'"', $html);
        $this->assertStringContainsString('enctype="multipart/form-data"', $html);
        $this->assertStringContainsString('name="csrf_token"', $html);
        $this->assertStringContainsString('Create', $html);
        $this->assertCspSafe($html);
    }

    // Kills: rows without editor/export links, an unescaped title, rename for a viewer, remove for a member.
    // (URLs are matched without the leading "/": the page's request and the test's build the base differently.)
    public function testListRowsAndRoleActions(): void
    {
        $id = $this->makeZine(null, '<b>Bold</b> issue');
        $editor = htmlspecialchars($this->url('ZineController', 'editor', ['zine_id' => $id]));
        $export = htmlspecialchars($this->url('ZineController', 'export', ['zine_id' => $id]));
        $rename = htmlspecialchars($this->url('ZineController', 'rename', ['zine_id' => $id]));
        $confirm = $this->container['helper']->url->href('ZineController', 'confirm', ['plugin' => 'HotDogPress', 'zine_id' => $id]);

        $this->loginAs('viewer');
        $html = $this->listPage();
        $this->assertStringContainsString('table-striped', $html);
        $this->assertStringContainsString('&lt;b&gt;Bold&lt;/b&gt; issue', $html);
        $this->assertStringNotContainsString('<b>Bold</b>', $html);
        $this->assertStringNotContainsString('No zines yet', $html);
        $this->assertStringContainsString($editor.'"', $html);
        $this->assertStringContainsString($export.'"', $html);
        $this->assertStringNotContainsString($rename, $html);
        $this->assertStringNotContainsString($confirm, $html);

        $this->loginAs('member');
        $html = $this->listPage();
        $this->assertStringContainsString($rename.'"', $html);
        $this->assertStringNotContainsString($confirm, $html);

        $this->loginAs('manager');
        $html = $this->listPage();
        $this->assertStringContainsString($confirm, $html);
        $this->assertCspSafe($html);
    }

    // Kills: My zines without the project name, rows without links, or an empty state without the flavour line.
    public function testMyZinesPage(): void
    {
        $this->loginAs('viewer');
        $html = $this->call(MyZinesController::class, 'index')['body'];
        $this->assertStringContainsString('No zines yet', $html);
        $this->assertStringContainsString('The griddle’s cold. Make your first zine.', $html);

        $id = $this->makeZine(null, 'Ours');
        $html = $this->call(MyZinesController::class, 'index')['body'];
        $this->assertStringContainsString('Ours', $html);
        $this->assertStringContainsString('Zines', $html);
        $this->assertStringContainsString(htmlspecialchars($this->url('ZineController', 'editor', ['zine_id' => $id])).'"', $html);
        $this->assertStringContainsString(self::CSS, $html);
        $this->assertCspSafe($html);
    }

    // Kills: a missing app root, config block or module script; routes, token, ids or rights that do not match
    // the zine and the user; an image pattern without the {file_id} placeholder; strings missing.
    public function testEditorShellAndConfig(): void
    {
        $id = $this->zines()->create($this->project, 'Paper test', $this->dogJson('valid-minimal', ['paper' => 'a4']), $this->users['member']);
        $this->loginAs('member');
        $html = $this->editorPage($id);

        $this->assertStringContainsString('<div id="hotdogpress-app"', $html);
        $this->assertStringContainsString('data-error="The editor could not start. Reload the page to try again."', $html, 'the boot error is translated in the page');
        // A classic boot script imports the app: a module that fails to load or link shows data-error, not "Loading".
        // Both URLs carry the plugin version, as every import inside the app does (Test/js/versioned-imports.test.mjs).
        $v = \Kanboard\Plugin\HotDogPress\Plugin::VERSION;
        $this->assertStringContainsString(
            '<script src="/'.self::BOOT.'?v='.$v.'" data-main="/'.self::MAIN.'?v='.$v.'" defer></script>', $html
        );
        $this->assertStringNotContainsString('type="module"', $html);
        $this->assertStringContainsString(self::CSS, $html);
        $this->assertCspSafe($html);

        $config = $this->config($html);
        $this->assertSame($id, $config['zine_id']);
        $this->assertSame($this->project, $config['project_id']);
        $this->assertSame(1, $config['revision']);
        $this->assertTrue($config['can_edit']);
        $this->assertSame('a4', $config['paper']);
        $this->assertSame('en_US', $config['user_lang']);
        $this->assertTrue($this->container['token']->validateReusableCSRFToken($config['csrf_token']));
        foreach (['load', 'save', 'upload', 'pdf', 'export'] as $action) {
            $controller = $action === 'export' ? 'ZineController' : 'ZineApiController';
            $this->assertSame($this->url($controller, $action, ['zine_id' => $id]), $config['routes'][$action], $action);
        }
        $this->assertSame($this->url('ZineController', 'index', ['project_id' => $this->project]), $config['routes']['list']);
        $this->assertSame(
            $this->url('ZineApiController', 'image', ['zine_id' => $id, 'file_id' => 42]),
            str_replace('{file_id}', '42', $config['routes']['image'])
        );
        $this->assertSame(array_keys(EditorConfig::strings()), array_keys($config['strings']));
        $this->assertSame('Print at Actual size (100%), on %s, one side.', $config['strings']['print_note']);
        $this->assertSame('Couldn’t save. Retrying…', $config['strings']['save_failed']);
        $this->assertSame('Made to order. Fold your own.', $config['strings']['story_caption']);
    }

    // Kills: can_edit true for a viewer (the app would offer tools that the server refuses).
    public function testViewerEditorIsReadOnly(): void
    {
        $id = $this->makeZine();
        $this->loginAs('viewer');
        $this->assertFalse($this->config($this->editorPage($id))['can_edit']);
    }

    // Kills: the stylesheet or the app registered in initialize() (they would load on every Kanboard page), or the
    // app module on the list page.
    public function testAssetsOnlyOnPluginPages(): void
    {
        $css = array_column($this->container['hook']->getListeners('template:layout:css'), 'template');
        $js = array_column($this->container['hook']->getListeners('template:layout:js'), 'template');
        $this->assertNotContains(self::CSS, $css);
        $this->assertNotContains(self::MAIN, $js);

        $this->loginAs('viewer');
        $html = $this->listPage();
        $this->assertStringContainsString(self::CSS, $html);
        $this->assertStringNotContainsString('main.js', $html);
        $this->assertStringNotContainsString('boot.js', $html);
    }

    // Kills: es_ES strings not reaching the editor config (the app would always be English).
    public function testSpanishStringsReachTheConfig(): void
    {
        $id = $this->makeZine();
        $this->loginAs('member');
        \Kanboard\Core\Translator::load('es_ES', __DIR__.'/../Locale');
        try {
            $strings = $this->config($this->editorPage($id))['strings'];
        } finally {
            \Kanboard\Core\Translator::unload();
        }
        $this->assertSame('Páginas', $strings['view_pages']);
        $this->assertSame('Imprime a tamaño real (100%), en %s, a una cara.', $strings['print_note']);
    }
}
