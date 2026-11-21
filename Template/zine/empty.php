<?php // The empty state: the plain label always, the flavour line beside it (branding voice). ?>
<div class="hotdogpress-empty">
    <?= $this->render('HotDogPress:icon/bun', ['size' => 48]) ?>
    <p class="hotdogpress-empty-title"><?= t('No zines yet') ?></p>
    <p class="hotdogpress-empty-flavour"><?= t('The griddle’s cold. Make your first zine.') ?></p>
</div>
