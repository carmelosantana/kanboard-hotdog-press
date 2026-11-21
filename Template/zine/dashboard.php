<?php // My zines: every zine in the user's projects, last changed first. ?>
<div class="page-header">
    <h2><?= t('My zines') ?></h2>
</div>
<div class="hotdogpress">
<?php if ($paginator->isEmpty()): ?>
    <?= $this->render('HotDogPress:zine/empty') ?>
<?php else: ?>
    <table class="table-striped table-scrolling hotdogpress-zines">
        <tr>
            <th><?= t('Title') ?></th>
            <th class="column-30"><?= t('Project') ?></th>
            <th class="column-20"><?= t('Last changed') ?></th>
        </tr>
        <?php foreach ($paginator->getCollection() as $zine): ?>
        <tr>
            <td><?= $this->url->link($this->text->e($zine['title']), 'ZineController', 'editor', ['plugin' => 'HotDogPress', 'zine_id' => $zine['id']]) ?></td>
            <td><?= $this->url->link($this->text->e($zine['project_name']), 'ZineController', 'index', ['plugin' => 'HotDogPress', 'project_id' => $zine['project_id']]) ?></td>
            <td><?= $this->dt->datetime($zine['updated_at']) ?></td>
        </tr>
        <?php endforeach ?>
    </table>
    <?= $paginator ?>
<?php endif ?>
</div>
