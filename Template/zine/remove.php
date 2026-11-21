<div class="page-header">
    <h2><?= t('Remove a zine') ?></h2>
</div>
<div class="confirm">
    <p class="alert alert-info">
        <?= t('Do you really want to remove this zine: "%s"?', $this->text->e($zine['title'])) ?>
    </p>
    <?= $this->modal->confirmButtons('ZineController', 'remove', ['plugin' => 'HotDogPress', 'zine_id' => $zine['id']]) ?>
</div>
