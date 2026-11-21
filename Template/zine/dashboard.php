<?php // Stub until Task 10: My zines across the user's projects. ?>
<div class="page-header">
    <h2><?= t('My zines') ?></h2>
</div>
<?php if ($paginator->isEmpty()): ?>
    <p class="alert"><?= t('No zines yet') ?></p>
<?php else: ?>
    <ul class="hotdogpress-zines">
    <?php foreach ($paginator->getCollection() as $zine): ?>
        <li>
            <?= $this->url->link($this->text->e($zine['title']), 'ZineController', 'editor', ['plugin' => 'HotDogPress', 'zine_id' => $zine['id']]) ?>
            · <?= $this->text->e($zine['project_name']) ?>
        </li>
    <?php endforeach ?>
    </ul>
    <?= $paginator ?>
<?php endif ?>
