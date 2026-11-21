<?php
require_once 'tests/units/Base.php';

use KanboardTests\units\Base;
use Kanboard\Plugin\HotDogPress\Plugin;

// Tag == plugin.json == getPluginVersion(): drift across the three is the most common release defect.
class PluginVersionTest extends Base
{
    public function testVersionsAgree(): void
    {
        $json = json_decode(file_get_contents(__DIR__.'/../plugin.json'), true);
        $plugin = new Plugin($this->container);

        $this->assertSame('0.1.0', $json['version']);
        $this->assertSame($json['version'], $plugin->getPluginVersion());
        $this->assertSame($json['version'], Plugin::VERSION, 'the ?v= on the editor scripts');
        $this->assertSame('HotDogPress', $json['name']);
        $this->assertSame($json['name'], $plugin->getPluginName());
        $this->assertSame('>=1.2.47', $json['kanboard_version']);
        $this->assertSame($json['kanboard_version'], $plugin->getCompatibleVersion());
        $this->assertSame('>=8.4', $json['php_version']);
        $this->assertSame('MIT', $json['license']);
        $this->assertSame('Carmelo Santana', $json['author']);
        $this->assertSame($json['author'], $plugin->getPluginAuthor());
        $this->assertSame($json['description'], $plugin->getPluginDescription());
        $this->assertSame('https://github.com/carmelosantana/kanboard-hotdog-press', $json['homepage']);
        $this->assertSame($json['homepage'], $plugin->getPluginHomepage());
        $this->assertSame([], $json['requires']);
        $this->assertSame([], $json['recommends']);
    }
}
