<?php
namespace Kanboard\Plugin\HotDogPress;

use Kanboard\Core\Plugin\Base;
use Kanboard\Core\Security\Role;
use Kanboard\Core\Translator;

class Plugin extends Base
{
    /** plugin.json's version; also the ?v= on the editor's scripts and every import inside the app. */
    public const VERSION = '0.1.0';

    public function initialize(): void
    {
        // Project-scoped pages: core's middleware checks the role for :project_id, and the controllers again.
        $this->route->addRoute('hotdogpress/project/:project_id', 'ZineController', 'index', 'HotDogPress');
        $this->route->addRoute('hotdogpress/project/:project_id/create', 'ZineController', 'create', 'HotDogPress');
        $this->route->addRoute('hotdogpress/project/:project_id/import', 'ZineController', 'import', 'HotDogPress');
        // Zine-scoped routes carry no project_id: ZineAccess resolves the zine's project and checks the role there.
        $this->route->addRoute('hotdogpress/zine/:zine_id', 'ZineController', 'editor', 'HotDogPress');
        $this->route->addRoute('hotdogpress/zine/:zine_id/rename', 'ZineController', 'rename', 'HotDogPress');
        $this->route->addRoute('hotdogpress/zine/:zine_id/confirm', 'ZineController', 'confirm', 'HotDogPress');
        $this->route->addRoute('hotdogpress/zine/:zine_id/remove', 'ZineController', 'remove', 'HotDogPress');
        $this->route->addRoute('hotdogpress/zine/:zine_id/export', 'ZineController', 'export', 'HotDogPress');
        $this->route->addRoute('hotdogpress/zine/:zine_id/load', 'ZineApiController', 'load', 'HotDogPress');
        $this->route->addRoute('hotdogpress/zine/:zine_id/save', 'ZineApiController', 'save', 'HotDogPress');
        $this->route->addRoute('hotdogpress/zine/:zine_id/upload', 'ZineApiController', 'upload', 'HotDogPress');
        $this->route->addRoute('hotdogpress/zine/:zine_id/pdf', 'ZineApiController', 'pdf', 'HotDogPress');
        $this->route->addRoute('hotdogpress/zine/:zine_id/image/:file_id', 'ZineApiController', 'image', 'HotDogPress');
        $this->route->addRoute('hotdogpress/mine', 'MyZinesController', 'index', 'HotDogPress');

        // Unlisted actions default to project viewer (index, editor, export, load, image).
        $this->projectAccessMap->add('ZineController', ['create', 'rename', 'import'], Role::PROJECT_MEMBER);
        $this->projectAccessMap->add('ZineController', ['confirm', 'remove'], Role::PROJECT_MANAGER);
        $this->projectAccessMap->add('ZineApiController', ['save', 'upload', 'pdf'], Role::PROJECT_MEMBER);

        // "Zines" in the project's gear menu, its view tabs and its settings sidebar; "My zines" on the dashboard.
        // Only the plugin's pages load assets: hotdogpress.css via the controllers (PluginPage), main.js via the editor.
        $this->hook->on('template:project:dropdown', ['template' => 'HotDogPress:project/menu_item']);
        $this->hook->on('template:project-header:view-switcher', ['template' => 'HotDogPress:project/menu_item']);
        $this->hook->on('template:project:sidebar', ['template' => 'HotDogPress:project/menu_item']);
        $this->hook->on('template:dashboard:sidebar', ['template' => 'HotDogPress:dashboard/sidebar']);
    }

    public function onStartup(): void
    {
        Translator::load($this->languageModel->getCurrentLanguage(), __DIR__.'/Locale');
    }

    public function getPluginName(): string        { return 'HotDogPress'; }
    public function getPluginDescription(): string { return t('Make a single-sheet, eight-page zine and print it at home.'); }
    public function getPluginAuthor(): string      { return 'Carmelo Santana'; }
    public function getPluginVersion(): string     { return self::VERSION; }
    public function getPluginHomepage(): string    { return 'https://github.com/carmelosantana/kanboard-hotdog-press'; }
    public function getCompatibleVersion(): string { return '>=1.2.47'; }
}
