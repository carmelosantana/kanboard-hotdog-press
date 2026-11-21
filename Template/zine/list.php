<?php // The zines of one project: a table (rename for members, remove for managers), the create and import forms. ?>
<div class="page-header">
    <h2><?= t('Zines') ?></h2>
</div>
<div class="hotdogpress">
<?php if (empty($zines)): ?>
    <?= $this->render('HotDogPress:zine/empty') ?>
<?php else: ?>
    <table class="table-striped table-scrolling hotdogpress-zines">
        <tr>
            <th><?= t('Title') ?></th>
            <th class="column-20"><?= t('Last changed') ?></th>
            <th class="column-30"><?= t('Actions') ?></th>
        </tr>
        <?php foreach ($zines as $zine): ?>
        <tr>
            <td><?= $this->url->link($this->text->e($zine['title']), 'ZineController', 'editor', ['plugin' => 'HotDogPress', 'zine_id' => $zine['id']]) ?></td>
            <td><?= $this->dt->datetime($zine['updated_at']) ?></td>
            <td>
                <?= $this->url->icon('download', t('Download .hotdog'), 'ZineController', 'export', ['plugin' => 'HotDogPress', 'zine_id' => $zine['id']]) ?>
                <?php if ($can_remove): ?>
                    &nbsp;<?= $this->modal->confirm('trash-o', t('Remove'), 'ZineController', 'confirm', ['plugin' => 'HotDogPress', 'zine_id' => $zine['id']]) ?>
                <?php endif ?>
                <?php if ($can_rename): ?>
                    <details class="hotdogpress-rename">
                        <summary><?= t('Rename') ?></summary>
                        <form method="post" action="<?= $this->url->href('ZineController', 'rename', ['plugin' => 'HotDogPress', 'zine_id' => $zine['id']]) ?>" autocomplete="off">
                            <?= $this->form->csrf() ?>
                            <input type="text" name="title" value="<?= $this->text->e($zine['title']) ?>" maxlength="255" required aria-label="<?= t('Title') ?>">
                            <button type="submit" class="btn btn-blue"><?= t('Save') ?></button>
                        </form>
                    </details>
                <?php endif ?>
            </td>
        </tr>
        <?php endforeach ?>
    </table>
<?php endif ?>

<?php if ($can_create): ?>
    <div class="hotdogpress-forms">
        <form method="post" action="<?= $this->url->href('ZineController', 'create', ['plugin' => 'HotDogPress', 'project_id' => $project['id']]) ?>" autocomplete="off">
            <?= $this->form->csrf() ?>
            <label for="hotdogpress-new-title"><?= t('New zine') ?></label>
            <input type="text" id="hotdogpress-new-title" name="title" maxlength="255" placeholder="<?= t('Title') ?>">
            <button type="submit" class="btn btn-blue"><?= t('Create') ?></button>
        </form>
        <form method="post" action="<?= $this->url->href('ZineController', 'import', ['plugin' => 'HotDogPress', 'project_id' => $project['id']]) ?>" enctype="multipart/form-data">
            <?= $this->form->csrf() ?>
            <label for="hotdogpress-import"><?= t('Import a .hotdog file') ?></label>
            <input type="file" id="hotdogpress-import" name="file" accept=".hotdog,application/json" required>
            <button type="submit" class="btn"><?= t('Import') ?></button>
        </form>
    </div>
<?php endif ?>
</div>
