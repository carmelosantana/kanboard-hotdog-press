<?php // Stub until Task 10: the zines of one project. ?>
<div class="page-header">
    <h2><?= t('Zines') ?></h2>
</div>
<?php if (empty($zines)): ?>
    <p class="alert"><?= t('No zines yet') ?></p>
<?php else: ?>
    <ul class="hotdogpress-zines">
    <?php foreach ($zines as $zine): ?>
        <li><?= $this->url->link($this->text->e($zine['title']), 'ZineController', 'editor', ['plugin' => 'HotDogPress', 'zine_id' => $zine['id']]) ?></li>
    <?php endforeach ?>
    </ul>
<?php endif ?>
