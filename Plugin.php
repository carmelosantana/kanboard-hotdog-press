<?php
namespace Kanboard\Plugin\HotDogPress;

use Kanboard\Core\Plugin\Base;
use Kanboard\Core\Security\Role;

class Plugin extends Base
{
    public function initialize(): void
    {
        // Task 1 browser spike (removed at the end of the task).
        $this->route->addRoute('hotdogpress/spike', 'SpikeController', 'show', 'HotDogPress');
        $this->applicationAccessMap->add('SpikeController', '*', Role::APP_ADMIN);
    }

    public function getPluginName(): string        { return 'HotDogPress'; }
    public function getPluginDescription(): string { return t('Make a single-sheet, eight-page zine and print it at home.'); }
    public function getPluginAuthor(): string      { return 'Carmelo Santana'; }
    public function getPluginVersion(): string     { return '0.1.0'; }
    public function getPluginHomepage(): string    { return 'https://github.com/carmelosantana/kanboard-hotdog-press'; }
    public function getCompatibleVersion(): string { return '>=1.2.47'; }
}
