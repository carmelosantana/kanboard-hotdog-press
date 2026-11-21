<?php
namespace Kanboard\Plugin\HotDogPress;

use Kanboard\Core\Plugin\Base;

class Plugin extends Base
{
    public function initialize(): void
    {
    }

    public function getPluginName(): string        { return 'HotDogPress'; }
    public function getPluginDescription(): string { return t('Make a single-sheet, eight-page zine and print it at home.'); }
    public function getPluginAuthor(): string      { return 'Carmelo Santana'; }
    public function getPluginVersion(): string     { return '0.1.0'; }
    public function getPluginHomepage(): string    { return 'https://github.com/carmelosantana/kanboard-hotdog-press'; }
    public function getCompatibleVersion(): string { return '>=1.2.47'; }
}
