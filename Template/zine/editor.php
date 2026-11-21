<?php
// The editor shell: the app root, its config as an inert JSON block (EditorConfig::FLAGS escape <, >, &, ' and "),
// and boot.js, which imports the app module (main.js) and shows data-error if it cannot. Only this page loads them.
// ?v= is the plugin version, as on every import inside the app, so an upgrade fetches every module afresh.
$v = '?v='.rawurlencode(\Kanboard\Plugin\HotDogPress\Plugin::VERSION);
$js = $this->url->dir().'plugins/HotDogPress/Assets/js/';
?>
<div class="page-header">
    <h2><?= $this->text->e($zine['title']) ?></h2>
    <ul>
        <li><a href="<?= $this->url->href('ZineController', 'index', ['plugin' => 'HotDogPress', 'project_id' => $zine['project_id']]) ?>"><?= $this->render('HotDogPress:icon/bun') ?><?= t('Zines') ?></a></li>
        <li><?= $this->url->icon('download', t('Download .hotdog'), 'ZineController', 'export', ['plugin' => 'HotDogPress', 'zine_id' => $zine['id']]) ?></li>
    </ul>
</div>
<div id="hotdogpress-app" class="hotdogpress hotdogpress-editor" data-error="<?= t('The editor could not start. Reload the page to try again.') ?>">
    <p class="hotdogpress-loading"><?= t('Loading the editor…') ?></p>
</div>
<script type="application/json" id="hotdogpress-config"><?= json_encode($config, \Kanboard\Plugin\HotDogPress\Controller\EditorConfig::FLAGS) ?></script>
<script src="<?= $js.'boot.js'.$v ?>" data-main="<?= $js.'app/main.js'.$v ?>" defer></script>
