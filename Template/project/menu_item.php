<?php // "Zines" for the project's gear menu, its view tabs and its settings sidebar (one item, three hooks). ?>
<?php if ($this->user->hasProjectAccess('ZineController', 'index', $project['id'])): ?>
<li <?= $this->app->checkMenuSelection('ZineController', '', 'HotDogPress') ?>>
    <a href="<?= $this->url->href('ZineController', 'index', ['plugin' => 'HotDogPress', 'project_id' => $project['id']]) ?>"><?= $this->render('HotDogPress:icon/bun') ?><?= t('Zines') ?></a>
</li>
<?php endif ?>
