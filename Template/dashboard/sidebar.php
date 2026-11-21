<li <?= $this->app->checkMenuSelection('MyZinesController', '', 'HotDogPress') ?>>
    <?= $this->url->link(t('My zines'), 'MyZinesController', 'index', ['plugin' => 'HotDogPress']) ?>
</li>
