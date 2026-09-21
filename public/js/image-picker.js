// 选图组件：管理一组待上传的图片文件，并在预览区显示缩略图（可单张移除）。
// 论坛的发帖与评论共用；文件校验（类型 / 大小 / 张数）也在这里，上传仍走 api。
import { toast } from './ui.js';

export const MAX_IMAGES = 3;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function createImagePicker({ input, button, preview, max = MAX_IMAGES, maxBytes = MAX_IMAGE_BYTES }) {
    let files = [];

    function render() {
        preview.replaceChildren();

        files.forEach((file, index) => {
            const item = document.createElement('div');
            item.className = 'image-preview';

            const img = document.createElement('img');
            img.src = URL.createObjectURL(file);
            img.alt = '';

            const del = document.createElement('button');
            del.type = 'button';
            del.className = 'image-preview-del';
            del.textContent = '×';
            del.setAttribute('aria-label', '移除这张图片');
            del.addEventListener('click', () => {
                files.splice(index, 1);
                render();
            });

            item.append(img, del);
            preview.append(item);
        });

        button.hidden = files.length >= max;
    }

    function add(fileList) {
        for (const file of Array.from(fileList || [])) {
            if (!String(file.type || '').startsWith('image/')) {
                toast('只能上传图片文件', 'error');
                continue;
            }
            if (file.size > maxBytes) {
                toast('图片太大了，请压缩到 5MB 以内', 'error');
                continue;
            }
            if (files.length >= max) {
                toast(`最多只能带 ${max} 张图片`, 'error');
                break;
            }
            files.push(file);
        }
        render();
    }

    function reset() {
        files = [];
        render();
    }

    button.addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
        add(input.files);
        input.value = '';
    });

    return {
        get files() { return files; },
        reset,
        render
    };
}
