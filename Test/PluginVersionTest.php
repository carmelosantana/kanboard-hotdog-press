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

        $this->assertSame('0.1.1', $json['version']);
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

    // Kills: a release with no changelog entry for its version, or a zip that ships the tests.
    public function testReleasePackaging(): void
    {
        $root = __DIR__.'/..';
        $version = json_decode(file_get_contents($root.'/plugin.json'), true)['version'];
        $this->assertMatchesRegularExpression('/^## '.preg_quote($version, '/').' — /m', (string) @file_get_contents($root.'/CHANGELOG.md'));
        $workflow = (string) @file_get_contents($root.'/.github/workflows/release.yml');
        $this->assertStringContainsString('does not match plugin.json', $workflow, 'the tag must equal the version');
        foreach (['.git', '.github', '.gitignore', 'Test', 'docs'] as $path) {
            $this->assertStringContainsString("--exclude '$path'", $workflow, "$path stays out of the zip");
        }
    }
}
