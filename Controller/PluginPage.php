<?php
namespace Kanboard\Plugin\HotDogPress\Controller;

// Attaches hotdogpress.css from the page actions instead of Plugin::initialize(), so it loads only on the plugin's
// own pages. The editor's module script is written by Template/zine/editor.php itself (core's js hook has no
// type="module").
trait PluginPage
{
    private function withStylesheet(): void
    {
        $this->hook->on('template:layout:css', ['template' => 'plugins/HotDogPress/Assets/css/hotdogpress.css']);
    }
}
