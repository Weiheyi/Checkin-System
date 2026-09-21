// 图片裁剪：拖动平移 + 滑块 / 滚轮缩放，确定后按目标尺寸导出 JPEG。
//
// 用法：const blob = await cropImage(file, { aspect: 1, outputWidth: 256, title: '裁剪头像' });
// 用户取消时 resolve(null)；选的文件不是图片会 reject。
//
// 预览用「绝对定位 + 实时改宽高」实现，好处是取景框里看到的和最终裁剪的
// 完全同一套坐标（视图像素 → 原图像素只差一个 scale），不会出现所见非所得。

const MIN_ZOOM = 1;      // 相对「刚好铺满取景框」的倍数
const MAX_ZOOM = 4;

export function cropImage(file, { aspect = 1, outputWidth = 512, quality = 0.85, title = '裁剪图片' } = {}) {
    return new Promise((resolve, reject) => {
        const objectUrl = URL.createObjectURL(file);
        const img = new Image();

        img.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error('这个文件不是能识别的图片'));
        };

        img.onload = () => {
            const state = { scale: 1, min: 1, max: 4, x: 0, y: 0, vw: 0, vh: 0 };

            const overlay = document.createElement('div');
            overlay.className = 'modal-overlay';

            const box = document.createElement('div');
            box.className = 'modal-box crop-box';
            box.setAttribute('role', 'dialog');
            box.setAttribute('aria-modal', 'true');

            const heading = document.createElement('h4');
            heading.className = 'modal-title';
            heading.textContent = title;

            const view = document.createElement('div');
            view.className = 'crop-view';
            view.style.aspectRatio = String(aspect);

            const preview = document.createElement('img');
            preview.className = 'crop-img';
            preview.src = objectUrl;
            preview.alt = '';
            preview.draggable = false;

            const grid = document.createElement('div');
            grid.className = 'crop-grid';

            view.append(preview, grid);

            const zoom = document.createElement('input');
            zoom.type = 'range';
            zoom.className = 'crop-zoom';
            zoom.min = '0';
            zoom.max = '100';
            zoom.value = '0';
            zoom.setAttribute('aria-label', '缩放');

            const hint = document.createElement('p');
            hint.className = 'crop-hint';
            hint.textContent = '拖动图片调整位置，用滑块或滚轮缩放';

            const actions = document.createElement('div');
            actions.className = 'modal-actions';

            const cancel = document.createElement('button');
            cancel.type = 'button';
            cancel.className = 'btn-ghost';
            cancel.textContent = '取消';

            const confirm = document.createElement('button');
            confirm.type = 'button';
            confirm.className = 'btn-primary';
            confirm.textContent = '确定';

            actions.append(cancel, confirm);
            box.append(heading, view, zoom, hint, actions);
            overlay.appendChild(box);
            document.body.appendChild(overlay);

            /* ---- 尺寸与坐标 ---- */

            function clamp() {
                const w = img.naturalWidth * state.scale;
                const h = img.naturalHeight * state.scale;
                state.x = Math.min(0, Math.max(state.vw - w, state.x));
                state.y = Math.min(0, Math.max(state.vh - h, state.y));
            }

            function paint() {
                const w = img.naturalWidth * state.scale;
                const h = img.naturalHeight * state.scale;
                preview.style.width = `${w}px`;
                preview.style.height = `${h}px`;
                preview.style.left = `${state.x}px`;
                preview.style.top = `${state.y}px`;
            }

            function layout() {
                state.vw = view.clientWidth;
                state.vh = view.clientHeight;
                if (!state.vw || !state.vh) return;

                // 初始：刚好铺满取景框并居中
                state.min = Math.max(state.vw / img.naturalWidth, state.vh / img.naturalHeight);
                state.max = state.min * MAX_ZOOM;
                state.scale = state.min;
                state.x = (state.vw - img.naturalWidth * state.scale) / 2;
                state.y = (state.vh - img.naturalHeight * state.scale) / 2;
                zoom.value = '0';
                clamp();
                paint();
            }

            // 以取景框中心为基准缩放，视觉上更符合直觉
            function zoomTo(nextScale) {
                const scale = Math.min(state.max, Math.max(state.min, nextScale));
                const cx = (state.vw / 2 - state.x) / state.scale;
                const cy = (state.vh / 2 - state.y) / state.scale;
                state.scale = scale;
                state.x = state.vw / 2 - cx * scale;
                state.y = state.vh / 2 - cy * scale;
                clamp();
                paint();
            }

            /* ---- 交互 ---- */

            let dragging = null;

            view.addEventListener('pointerdown', event => {
                event.preventDefault();
                dragging = { id: event.pointerId, x: event.clientX, y: event.clientY, left: state.x, top: state.y };
                view.setPointerCapture(event.pointerId);
                view.classList.add('dragging');
            });

            view.addEventListener('pointermove', event => {
                if (!dragging || event.pointerId !== dragging.id) return;
                state.x = dragging.left + (event.clientX - dragging.x);
                state.y = dragging.top + (event.clientY - dragging.y);
                clamp();
                paint();
            });

            const endDrag = event => {
                if (!dragging || event.pointerId !== dragging.id) return;
                dragging = null;
                view.classList.remove('dragging');
            };
            view.addEventListener('pointerup', endDrag);
            view.addEventListener('pointercancel', endDrag);

            view.addEventListener('wheel', event => {
                if (!state.vw) return;
                event.preventDefault();
                zoomTo(state.scale * (event.deltaY < 0 ? 1.12 : 1 / 1.12));
                zoom.value = String(Math.round(((state.scale - state.min) / (state.max - state.min)) * 100));
            }, { passive: false });

            zoom.addEventListener('input', () => {
                const t = Number(zoom.value) / 100;
                zoomTo(state.min + t * (state.max - state.min));
            });

            /* ---- 收尾 ---- */

            function close(result) {
                URL.revokeObjectURL(objectUrl);
                overlay.classList.remove('show');
                document.removeEventListener('keydown', onKey);
                window.removeEventListener('resize', layout);
                setTimeout(() => overlay.remove(), 180);
                resolve(result);
            }

            function onKey(event) {
                if (event.key === 'Escape') close(null);
            }

            cancel.addEventListener('click', () => close(null));
            overlay.addEventListener('click', event => {
                if (event.target === overlay) close(null);
            });
            document.addEventListener('keydown', onKey);

            confirm.addEventListener('click', () => {
                if (!state.vw) return close(null);

                const outW = Math.round(outputWidth);
                const outH = Math.max(1, Math.round(outputWidth / aspect));
                const canvas = document.createElement('canvas');
                canvas.width = outW;
                canvas.height = outH;

                const ctx = canvas.getContext('2d');
                ctx.imageSmoothingQuality = 'high';
                // 取景框 (0,0) 对应原图坐标 (-x/scale, -y/scale)：x 是负的，这里必须取负，
                // 否则源矩形会跑到图片外面，裁出来的图边上会缺一条（JPEG 里就是黑的）
                ctx.drawImage(
                    img,
                    -state.x / state.scale, -state.y / state.scale, state.vw / state.scale, state.vh / state.scale,
                    0, 0, outW, outH
                );

                canvas.toBlob(blob => close(blob), 'image/jpeg', quality);
            });

            window.addEventListener('resize', layout);
            requestAnimationFrame(() => {
                overlay.classList.add('show');
                layout();
                confirm.focus();
            });
        };

        img.src = objectUrl;
    });
}

// 等比缩放（不裁剪、不弹 UI）：最长边超过 maxSize 就缩到 maxSize，输出 JPEG Blob。
// 论坛配图用这个，而不是会弹裁剪框的 cropImage。
export function compressImage(file, { maxSize = 1600, quality = 0.85 } = {}) {
    return new Promise((resolve, reject) => {
        const objectUrl = URL.createObjectURL(file);
        const img = new Image();

        img.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error('这个文件不是能识别的图片'));
        };

        img.onload = () => {
            const longest = Math.max(img.naturalWidth, img.naturalHeight) || 1;
            const ratio = Math.min(1, maxSize / longest);
            const outW = Math.max(1, Math.round(img.naturalWidth * ratio));
            const outH = Math.max(1, Math.round(img.naturalHeight * ratio));

            const canvas = document.createElement('canvas');
            canvas.width = outW;
            canvas.height = outH;

            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, outW, outH);

            URL.revokeObjectURL(objectUrl);
            canvas.toBlob(blob => {
                if (blob) resolve(blob);
                else reject(new Error('图片处理失败，请换一张试试'));
            }, 'image/jpeg', quality);
        };

        img.src = objectUrl;
    });
}
