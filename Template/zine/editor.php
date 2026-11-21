<?php
// The editor shell: the app root, its config as an inert JSON block (EditorConfig::FLAGS escape <, >, &, ' and "),
// and the app as an ES module. Only this page loads main.js.
$main = 'plugins/HotDogPress/Assets/js/app/main.js';
?>
<div class="page-header">
    <h2><?= $this->text->e($zine['title']) ?></h2>
    <ul>
        <li><a href="<?= $this->url->href('ZineController', 'index', ['plugin' => 'HotDogPress', 'project_id' => $zine['project_id']]) ?>"><?= $this->render('HotDogPress:icon/bun') ?><?= t('Zines') ?></a></li>
        <li><?= $this->url->icon('download', t('Download .hotdog'), 'ZineController', 'export', ['plugin' => 'HotDogPress', 'zine_id' => $zine['id']]) ?></li>
    </ul>
</div>
<div id="hotdogpress-app" class="hotdogpress hotdogpress-editor">
    <p class="hotdogpress-loading"><?= t('Loading the editor…') ?></p>
</div>
<script type="application/json" id="hotdogpress-config"><?= json_encode($config, \Kanboard\Plugin\HotDogPress\Controller\EditorConfig::FLAGS) ?></script>
<script type="module" src="<?= $this->url->dir().$main.'?'.filemtime(__DIR__.'/../../Assets/js/app/main.js') ?>"></script>
