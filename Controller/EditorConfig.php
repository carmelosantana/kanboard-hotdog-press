<?php
namespace Kanboard\Plugin\HotDogPress\Controller;

use Kanboard\Core\Base;

/**
 * The editor's boot config, written into Template/zine/editor.php as a JSON block and read by Assets/js/app/config.js:
 * the zine's routes (image as a pattern with a {file_id} placeholder), the reusable CSRF token that save and upload
 * check, ids, revision, can_edit, paper, the user's language and every UI string the app shows, translated.
 */
class EditorConfig extends Base
{
    public const FLAGS = JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR;

    private const PAPERS = ['a4', 'letter'];

    public function forZine(array $zine, bool $canEdit): array
    {
        $id = (int) $zine['id'];
        $route = fn (string $controller, string $action, array $params = []) => $this->helper->url->to(
            $controller, $action, ['plugin' => 'HotDogPress', 'zine_id' => $id] + $params
        );
        $paper = json_decode((string) $zine['document'], true)['paper'] ?? null;

        return [
            'routes' => [
                'load' => $route('ZineApiController', 'load'),
                'save' => $route('ZineApiController', 'save'),
                'upload' => $route('ZineApiController', 'upload'),
                'pdf' => $route('ZineApiController', 'pdf'),
                'image' => str_replace('%7Bfile_id%7D', '{file_id}', $route('ZineApiController', 'image', ['file_id' => '{file_id}'])),
                'export' => $route('ZineController', 'export'),
                'list' => $this->helper->url->to('ZineController', 'index', ['plugin' => 'HotDogPress', 'project_id' => (int) $zine['project_id']]),
            ],
            'csrf_token' => $this->token->getReusableCSRFToken(),
            'zine_id' => $id,
            'project_id' => (int) $zine['project_id'],
            'revision' => (int) $zine['revision'],
            'can_edit' => $canEdit,
            'paper' => in_array($paper, self::PAPERS, true) ? $paper : 'letter',
            'user_lang' => $this->languageModel->getCurrentLanguage(),
            'strings' => self::strings(),
        ];
    }

    /**
     * Every string the editor app shows, through e() (translated, not HTML-escaped: the JSON flags make it safe).
     * A `%s` placeholder is passed through as '%s' for the app to fill; a literal percent is written `%%`.
     * Plain labels always; a flavour line only beside its label, never on errors (branding voice).
     *
     * @return array<string, string>
     */
    public static function strings(): array
    {
        return [
            'loading' => e('Loading the editor…'),
            'read_only' => e('You can view this zine but not change it.'),
            // Views
            'view_pages' => e('Pages'),
            'view_sheet' => e('Sheet'),
            'view_booklet' => e('Booklet'),
            'page_n' => e('Page %s', '%s'),
            'reorder_hint' => e('Drag a page to move it.'),
            // Tools
            'tool_select' => e('Select'),
            'tool_text' => e('Text'),
            'tool_photo' => e('Photo'),
            'tool_shape' => e('Shape'),
            'tool_sticker' => e('Sticker'),
            'tool_ink' => e('Ink'),
            'delete' => e('Delete'),
            'undo' => e('Undo'),
            'redo' => e('Redo'),
            'lock' => e('Lock'),
            'unlock' => e('Unlock'),
            'tools' => e('Tools'),
            // Pickers
            'paper' => e('Paper'),
            'paper_letter' => e('Letter'),
            'paper_a4' => e('A4'),
            'margin' => e('Margin (mm)'),
            'layout' => e('Layout'),
            'look' => e('Look'),
            'safe_area' => e('Safe area'),
            'layout_cover' => e('Cover'),
            'layout_back-cover' => e('Back cover'),
            'layout_headline-body' => e('Headline and body'),
            'layout_photo-full' => e('Full photo'),
            'layout_photo-caption' => e('Photo and caption'),
            'layout_list' => e('List'),
            'layout_quote' => e('Quote'),
            'layout_two-up' => e('Two up'),
            'layout_freeform' => e('Freeform'),
            'look_kraft' => e('Kraft'),
            'look_copy-shop' => e('Copy shop'),
            'look_night' => e('Night'),
            // Mustard panel
            'mustard' => e('Write in Mustard'),
            'mustard_apply' => e('Apply'),
            'mustard_warnings' => e('Warnings'),
            'close' => e('Close'),
            // Photos
            'uploading' => e('Uploading…'),
            'upload_types' => e('Only JPEG, PNG and WebP images are accepted.'),
            'upload_too_large' => e('An image must be at most 10 MB.'),
            'upload_failed' => e('Couldn’t upload the photo.'),
            // Editor (Task 11)
            'load_failed' => e('Couldn’t open this zine.'),
            'settings' => e('Settings'),
            'prev_page' => e('Previous page'),
            'next_page' => e('Next page'),
            'pages_strip' => e('Pages in reading order'),
            'reorder_pick' => e('Tap where page %s should go.', '%s'),
            'color' => e('Color'),
            'color_toner' => e('Ink'),
            'color_paper' => e('Paper'),
            'color_mustard' => e('Mustard'),
            'color_ketchup' => e('Ketchup'),
            'color_kraft' => e('Kraft'),
            'color_copy' => e('Copy paper'),
            'color_relish' => e('Relish'),
            'font' => e('Font'),
            'font_display' => e('Display'),
            'font_body' => e('Body'),
            'font_mono' => e('Typewriter'),
            'bigger' => e('Bigger text'),
            'smaller' => e('Smaller text'),
            'shape_rect' => e('Rectangle'),
            'shape_ellipse' => e('Ellipse'),
            'sticker_star-burst' => e('Star burst'),
            'sticker_arrow' => e('Arrow'),
            'sticker_underline' => e('Underline'),
            'sticker_fold-here' => e('Fold here'),
            'sticker_hot-dog' => e('Hot dog'),
            'mustard_errors' => e('Not applied. Fix these first:'),
            'mustard_applied' => e('Applied.'),
            'line_n' => e('Line %s', '%s'),
            // Autosave and the 409 prompt
            'saving' => e('Saving…'),
            'saved' => e('Saved'),
            'saved_flavour' => e('Fresh'),
            'save_failed' => e('Couldn’t save. Retrying…'),
            'conflict_title' => e('Someone else changed this zine'),
            'conflict_body' => e('Reload to see their changes, or keep yours and save over them.'),
            'conflict_reload' => e('Reload'),
            'conflict_keep' => e('Keep mine'),
            // Print
            'export' => e('Export'),
            'export_pdf' => e('Export PDF'),
            'export_flavour' => e('Order up'),
            'export_working' => e('Making your file…'),
            'export_failed' => e('Couldn’t make the file.'),
            'pdf_saved' => e('Saved to the project files as %s.', '%s'),
            'pdf_save_failed' => e('Couldn’t save the PDF to the project files.'),
            'print' => e('Print'),
            'guides' => e('Fold and cut guides'),
            'bw' => e('Black and white'),
            'save_pdf_to_files' => e('Save PDF to project files'),
            'print_note' => e('Print at Actual size (100%%), on %s, one side.', '%s'),
            'fold_title' => e('How to fold'),
            'fold_flavour' => e('Fold it like a hot dog'),
            // Social
            'social' => e('Social'),
            'carousel' => e('Carousel (ZIP)'),
            'carousel_3x4' => e('3:4'),
            'carousel_4x5' => e('4:5'),
            'carousel_size' => e('Carousel size'),
            'cover_image' => e('Cover image'),
            'pin' => e('Pin'),
            'story' => e('Story'),
            'story_caption' => e('Made to order. Fold your own.'),
            'sheet_image' => e('Sheet image'),
            'linkedin_pdf' => e('LinkedIn PDF'),
            'bluesky' => e('Bluesky set'),
            'share' => e('Share'),
            'download' => e('Download'),
            'download_hotdog' => e('Download .hotdog'),
        ];
    }
}
