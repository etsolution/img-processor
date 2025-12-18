/**
 * Image Processor - Client-side image processing with crop, resize, and MozJPEG compression
 * @version 1.0.0
 */

// ============================================================================
// Utility Functions
// ============================================================================

const Utils = {
    formatFileSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    },

    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    },

    async canvasToBlob(canvas, type = 'image/png', quality = 0.92) {
        return new Promise(resolve => canvas.toBlob(resolve, type, quality));
    },

    async decodeImageWithCanvas(arrayBuffer, mimeType) {
        const blob = new Blob([arrayBuffer], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const img = new Image();
        
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = url;
        });
        URL.revokeObjectURL(url);

        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, img.width, img.height);
    },

    clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }
};

// ============================================================================
// ZoomTool Class
// ============================================================================

class ZoomTool {
    constructor(processor) {
        this.processor = processor;
        this.scale = 'fit'; // 'fit' or number (1 = 100%)
        this.minScale = 0.1;
        this.maxScale = 10;
        this.panX = 0;
        this.panY = 0;
        this.isPanning = false;
        this.panStart = { x: 0, y: 0 };
        this.lastPan = { x: 0, y: 0 };

        this.elements = {
            container: document.getElementById('previewContainer'),
            wrapper: document.getElementById('previewWrapper'),
            image: document.getElementById('previewImage'),
            zoomIn: document.getElementById('zoomIn'),
            zoomOut: document.getElementById('zoomOut'),
            zoomFit: document.getElementById('zoomFit'),
            zoom100: document.getElementById('zoom100'),
            zoomLevel: document.getElementById('zoomLevel')
        };

        this._bindEvents();
    }

    _bindEvents() {
        const { zoomIn, zoomOut, zoomFit, zoom100, container, wrapper } = this.elements;

        zoomIn.addEventListener('click', () => this.zoomIn());
        zoomOut.addEventListener('click', () => this.zoomOut());
        zoomFit.addEventListener('click', () => this.fitToView());
        zoom100.addEventListener('click', () => this.setZoom(1));

        // Mouse wheel zoom
        container.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });

        // Pan with mouse drag
        container.addEventListener('mousedown', (e) => this._onPanStart(e));
        window.addEventListener('mousemove', (e) => this._onPanMove(e));
        window.addEventListener('mouseup', () => this._onPanEnd());

        // Pan with touch
        container.addEventListener('touchstart', (e) => this._onTouchStart(e), { passive: false });
        container.addEventListener('touchmove', (e) => this._onTouchMove(e), { passive: false });
        container.addEventListener('touchend', () => this._onPanEnd());

        // Double click to toggle fit/100%
        container.addEventListener('dblclick', () => {
            if (this.scale === 'fit' || this.scale < 1) {
                this.setZoom(1);
            } else {
                this.fitToView();
            }
        });
    }

    _onWheel(e) {
        if (!this.processor.imageData) return;
        e.preventDefault();
        
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        const currentScale = this.scale === 'fit' ? this._calculateFitScale() : this.scale;
        const newScale = Utils.clamp(currentScale * delta, this.minScale, this.maxScale);
        
        // Zoom towards mouse position
        const rect = this.elements.container.getBoundingClientRect();
        const mouseX = e.clientX - rect.left - rect.width / 2;
        const mouseY = e.clientY - rect.top - rect.height / 2;
        
        if (this.scale === 'fit') {
            this.panX = 0;
            this.panY = 0;
        }
        
        const scaleFactor = newScale / currentScale;
        this.panX = mouseX - (mouseX - this.panX) * scaleFactor;
        this.panY = mouseY - (mouseY - this.panY) * scaleFactor;
        
        this.setZoom(newScale);
    }

    _onPanStart(e) {
        if (this.scale === 'fit' || !this.processor.imageData) return;
        if (e.target.closest('#cropOverlay')) return; // Don't pan when cropping
        
        this.isPanning = true;
        this.panStart = { x: e.clientX, y: e.clientY };
        this.lastPan = { x: this.panX, y: this.panY };
        this.elements.container.style.cursor = 'grabbing';
    }

    _onPanMove(e) {
        if (!this.isPanning) return;
        
        const dx = e.clientX - this.panStart.x;
        const dy = e.clientY - this.panStart.y;
        
        this.panX = this.lastPan.x + dx;
        this.panY = this.lastPan.y + dy;
        
        this._constrainPan();
        this._applyTransform();
    }

    _onPanEnd() {
        if (this.isPanning) {
            this.isPanning = false;
            this.elements.container.style.cursor = this.scale === 'fit' ? 'default' : 'grab';
        }
    }

    _onTouchStart(e) {
        if (this.scale === 'fit' || !this.processor.imageData) return;
        if (e.target.closest('#cropOverlay')) return;
        if (e.touches.length !== 1) return;
        
        e.preventDefault();
        const touch = e.touches[0];
        this.isPanning = true;
        this.panStart = { x: touch.clientX, y: touch.clientY };
        this.lastPan = { x: this.panX, y: this.panY };
    }

    _onTouchMove(e) {
        if (!this.isPanning || e.touches.length !== 1) return;
        e.preventDefault();
        
        const touch = e.touches[0];
        const dx = touch.clientX - this.panStart.x;
        const dy = touch.clientY - this.panStart.y;
        
        this.panX = this.lastPan.x + dx;
        this.panY = this.lastPan.y + dy;
        
        this._constrainPan();
        this._applyTransform();
    }

    _calculateFitScale() {
        const { container, image } = this.elements;
        if (!image.naturalWidth) return 1;
        
        const containerRect = container.getBoundingClientRect();
        const scaleX = containerRect.width / image.naturalWidth;
        const scaleY = containerRect.height / image.naturalHeight;
        return Math.min(scaleX, scaleY, 1); // Don't upscale
    }

    _constrainPan() {
        if (this.scale === 'fit') return;
        
        const { container, image } = this.elements;
        const containerRect = container.getBoundingClientRect();
        const scaledWidth = image.naturalWidth * this.scale;
        const scaledHeight = image.naturalHeight * this.scale;
        
        const maxPanX = Math.max(0, (scaledWidth - containerRect.width) / 2);
        const maxPanY = Math.max(0, (scaledHeight - containerRect.height) / 2);
        
        this.panX = Utils.clamp(this.panX, -maxPanX, maxPanX);
        this.panY = Utils.clamp(this.panY, -maxPanY, maxPanY);
    }

    _applyTransform() {
        const { image, wrapper, container } = this.elements;
        
        if (this.scale === 'fit') {
            image.style.transform = '';
            image.style.maxWidth = '100%';
            image.style.maxHeight = '600px';
            wrapper.style.overflow = 'hidden';
            container.style.cursor = 'default';
        } else {
            image.style.maxWidth = 'none';
            image.style.maxHeight = 'none';
            image.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.scale})`;
            wrapper.style.overflow = 'hidden';
            container.style.cursor = this.isPanning ? 'grabbing' : 'grab';
        }
    }

    _updateLabel() {
        if (this.scale === 'fit') {
            this.elements.zoomLevel.textContent = 'Fit';
        } else {
            this.elements.zoomLevel.textContent = Math.round(this.scale * 100) + '%';
        }
    }

    setZoom(scale) {
        this.scale = scale;
        if (scale !== 'fit') {
            this._constrainPan();
        }
        this._applyTransform();
        this._updateLabel();
    }

    zoomIn() {
        const currentScale = this.scale === 'fit' ? this._calculateFitScale() : this.scale;
        const newScale = Utils.clamp(currentScale * 1.25, this.minScale, this.maxScale);
        this.setZoom(newScale);
    }

    zoomOut() {
        const currentScale = this.scale === 'fit' ? this._calculateFitScale() : this.scale;
        const newScale = Utils.clamp(currentScale / 1.25, this.minScale, this.maxScale);
        this.setZoom(newScale);
    }

    fitToView() {
        this.scale = 'fit';
        this.panX = 0;
        this.panY = 0;
        this._applyTransform();
        this._updateLabel();
    }

    reset() {
        this.fitToView();
    }

    syncUIState() {
        this._updateLabel();
        this._applyTransform();
    }
}

// ============================================================================
// CropTool Class
// ============================================================================

class CropTool {
    constructor(processor) {
        this.processor = processor;
        this.enabled = false;
        this.rect = { x: 0, y: 0, width: 0, height: 0 };
        this.aspectRatio = null;
        this.isDragging = false;
        this.dragStart = { x: 0, y: 0 };
        
        this.elements = {
            toggle: document.getElementById('enableCrop'),
            options: document.getElementById('cropOptions'),
            overlay: document.getElementById('cropOverlay'),
            canvas: document.getElementById('cropCanvas'),
            aspectSelect: document.getElementById('cropAspectRatio'),
            x: document.getElementById('cropX'),
            y: document.getElementById('cropY'),
            width: document.getElementById('cropWidth'),
            height: document.getElementById('cropHeight'),
            applyBtn: document.getElementById('applyCropBtn')
        };
        
        this._bindEvents();
    }

    _bindEvents() {
        const { toggle, aspectSelect, x, y, width, height, applyBtn, canvas } = this.elements;

        toggle.addEventListener('change', () => this._onToggle());
        aspectSelect.addEventListener('change', () => this._onAspectChange());
        x.addEventListener('input', () => this._onInputChange('x'));
        y.addEventListener('input', () => this._onInputChange('y'));
        width.addEventListener('input', () => this._onInputChange('width'));
        height.addEventListener('input', () => this._onInputChange('height'));
        applyBtn.addEventListener('click', () => this.apply());

        // Mouse events
        canvas.addEventListener('mousedown', (e) => this._onDragStart(e));
        canvas.addEventListener('mousemove', (e) => this._onDragMove(e));
        canvas.addEventListener('mouseup', () => this._onDragEnd());
        canvas.addEventListener('mouseleave', () => this._onDragEnd());

        // Touch events
        canvas.addEventListener('touchstart', (e) => this._onTouchStart(e), { passive: false });
        canvas.addEventListener('touchmove', (e) => this._onTouchMove(e), { passive: false });
        canvas.addEventListener('touchend', () => this._onDragEnd());

        // Window resize
        window.addEventListener('resize', () => {
            if (this.enabled) this.drawOverlay();
        });
    }

    _onToggle() {
        this.enabled = this.elements.toggle.checked;
        const { options, overlay } = this.elements;

        if (this.enabled) {
            // Reset zoom to fit when enabling crop mode
            if (this.processor.zoomTool) {
                this.processor.zoomTool.fitToView();
            }
            options.classList.remove('opacity-50', 'pointer-events-none');
            overlay.classList.remove('hidden');
            this.rect = { x: 0, y: 0, width: this.processor.width, height: this.processor.height };
            this._updateInputs();
            setTimeout(() => this.drawOverlay(), 100);
        } else {
            options.classList.add('opacity-50', 'pointer-events-none');
            overlay.classList.add('hidden');
        }
    }

    _onAspectChange() {
        const value = this.elements.aspectSelect.value;
        if (value === 'free') {
            this.aspectRatio = null;
        } else {
            const [w, h] = value.split(':').map(Number);
            this.aspectRatio = w / h;
            const constrained = this._constrainToAspect(this.rect.width, this.rect.height);
            this.rect.width = constrained.width;
            this.rect.height = constrained.height;
            this.rect.x = Math.max(0, (this.processor.width - this.rect.width) / 2);
            this.rect.y = Math.max(0, (this.processor.height - this.rect.height) / 2);
            this._updateInputs();
            this.drawOverlay();
        }
    }

    _onInputChange(field) {
        const { width: imgW, height: imgH } = this.processor;
        
        switch (field) {
            case 'x':
                this.rect.x = Math.max(0, Math.min(parseInt(this.elements.x.value) || 0, imgW - this.rect.width));
                break;
            case 'y':
                this.rect.y = Math.max(0, Math.min(parseInt(this.elements.y.value) || 0, imgH - this.rect.height));
                break;
            case 'width':
                let w = Math.max(1, Math.min(parseInt(this.elements.width.value) || 1, imgW - this.rect.x));
                if (this.aspectRatio) {
                    const constrained = this._constrainToAspect(w, w / this.aspectRatio);
                    w = constrained.width;
                    this.rect.height = constrained.height;
                    this.elements.height.value = Math.round(this.rect.height);
                }
                this.rect.width = w;
                break;
            case 'height':
                let h = Math.max(1, Math.min(parseInt(this.elements.height.value) || 1, imgH - this.rect.y));
                if (this.aspectRatio) {
                    const constrained = this._constrainToAspect(h * this.aspectRatio, h);
                    h = constrained.height;
                    this.rect.width = constrained.width;
                    this.elements.width.value = Math.round(this.rect.width);
                }
                this.rect.height = h;
                break;
        }
        this.drawOverlay();
    }

    _constrainToAspect(width, height) {
        if (!this.aspectRatio) return { width, height };
        const currentRatio = width / height;
        if (currentRatio > this.aspectRatio) {
            return { width: height * this.aspectRatio, height };
        }
        return { width, height: width / this.aspectRatio };
    }

    _getImageScale() {
        const img = this.processor.elements.previewImage;
        const container = this.processor.elements.previewContainer;
        const imgRect = img.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        
        return {
            scaleX: this.processor.width / imgRect.width,
            scaleY: this.processor.height / imgRect.height,
            offsetX: imgRect.left - containerRect.left,
            offsetY: imgRect.top - containerRect.top,
            displayWidth: imgRect.width,
            displayHeight: imgRect.height
        };
    }

    _getEventCoords(e, scale, rect) {
        const clientX = e.clientX ?? e.touches?.[0]?.clientX;
        const clientY = e.clientY ?? e.touches?.[0]?.clientY;
        return {
            x: (clientX - rect.left - scale.offsetX) * scale.scaleX,
            y: (clientY - rect.top - scale.offsetY) * scale.scaleY
        };
    }

    _onDragStart(e) {
        if (!this.enabled) return;
        this.isDragging = true;
        const rect = this.elements.canvas.getBoundingClientRect();
        const scale = this._getImageScale();
        const coords = this._getEventCoords(e, scale, rect);
        
        this.dragStart = coords;
        this.rect.x = Math.max(0, Math.min(coords.x, this.processor.width));
        this.rect.y = Math.max(0, Math.min(coords.y, this.processor.height));
        this.rect.width = 0;
        this.rect.height = 0;
    }

    _onDragMove(e) {
        if (!this.isDragging) return;
        const rect = this.elements.canvas.getBoundingClientRect();
        const scale = this._getImageScale();
        const coords = this._getEventCoords(e, scale, rect);
        
        let w = coords.x - this.dragStart.x;
        let h = coords.y - this.dragStart.y;

        if (w < 0) {
            this.rect.x = Math.max(0, this.dragStart.x + w);
            w = Math.abs(w);
        } else {
            this.rect.x = this.dragStart.x;
        }
        
        if (h < 0) {
            this.rect.y = Math.max(0, this.dragStart.y + h);
            h = Math.abs(h);
        } else {
            this.rect.y = this.dragStart.y;
        }

        if (this.aspectRatio) {
            const constrained = this._constrainToAspect(w, h);
            w = constrained.width;
            h = constrained.height;
        }

        this.rect.width = Math.min(w, this.processor.width - this.rect.x);
        this.rect.height = Math.min(h, this.processor.height - this.rect.y);
        
        this._updateInputs();
        this.drawOverlay();
    }

    _onDragEnd() {
        this.isDragging = false;
    }

    _onTouchStart(e) {
        if (!this.enabled) return;
        e.preventDefault();
        this._onDragStart(e.touches[0]);
    }

    _onTouchMove(e) {
        if (!this.isDragging) return;
        e.preventDefault();
        this._onDragMove(e.touches[0]);
    }

    _updateInputs() {
        this.elements.x.value = Math.round(this.rect.x);
        this.elements.y.value = Math.round(this.rect.y);
        this.elements.width.value = Math.round(this.rect.width);
        this.elements.height.value = Math.round(this.rect.height);
    }

    drawOverlay() {
        if (!this.enabled || !this.processor.imageData) return;

        const canvas = this.elements.canvas;
        const ctx = canvas.getContext('2d');
        const container = this.processor.elements.previewContainer;
        const containerRect = container.getBoundingClientRect();
        
        canvas.width = containerRect.width;
        canvas.height = containerRect.height;

        const scale = this._getImageScale();
        
        // Semi-transparent overlay
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Calculate display coordinates
        const displayX = scale.offsetX + (this.rect.x / scale.scaleX);
        const displayY = scale.offsetY + (this.rect.y / scale.scaleY);
        const displayW = this.rect.width / scale.scaleX;
        const displayH = this.rect.height / scale.scaleY;

        // Clear crop area
        ctx.clearRect(displayX, displayY, displayW, displayH);

        // Border
        ctx.strokeStyle = '#9333ea';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.strokeRect(displayX, displayY, displayW, displayH);

        // Corner handles
        ctx.fillStyle = '#9333ea';
        const handleSize = 8;
        [[displayX, displayY], [displayX + displayW, displayY], 
         [displayX, displayY + displayH], [displayX + displayW, displayY + displayH]]
            .forEach(([cx, cy]) => {
                ctx.fillRect(cx - handleSize / 2, cy - handleSize / 2, handleSize, handleSize);
            });
    }

    cropImageData(imageData) {
        const { x, y, width, height } = this.rect;
        const sx = Math.max(0, Math.min(Math.round(x), imageData.width - 1));
        const sy = Math.max(0, Math.min(Math.round(y), imageData.height - 1));
        const sw = Math.min(Math.round(width), imageData.width - sx);
        const sh = Math.min(Math.round(height), imageData.height - sy);

        if (sw <= 0 || sh <= 0) return imageData;

        const croppedData = new Uint8ClampedArray(sw * sh * 4);
        for (let row = 0; row < sh; row++) {
            const srcStart = ((sy + row) * imageData.width + sx) * 4;
            const dstStart = row * sw * 4;
            croppedData.set(imageData.data.subarray(srcStart, srcStart + sw * 4), dstStart);
        }
        return new ImageData(croppedData, sw, sh);
    }

    async apply() {
        if (!this.processor.imageData || this.rect.width <= 0 || this.rect.height <= 0) {
            alert('Please select a crop area first');
            return;
        }

        this.processor.showLoading('Applying crop...', 50);

        // Apply crop
        this.processor.imageData = this.cropImageData(this.processor.imageData);
        this.processor.width = this.processor.imageData.width;
        this.processor.height = this.processor.imageData.height;
        this.processor.aspectRatio = this.processor.width / this.processor.height;

        // Update UI
        this.processor.elements.originalDimensions.textContent = `${this.processor.width} × ${this.processor.height}`;
        this.processor.resizeTool.elements.width.value = this.processor.width;
        this.processor.resizeTool.elements.height.value = this.processor.height;

        // Create preview
        const canvas = document.createElement('canvas');
        canvas.width = this.processor.width;
        canvas.height = this.processor.height;
        canvas.getContext('2d').putImageData(this.processor.imageData, 0, 0);
        
        const blob = await Utils.canvasToBlob(canvas);
        this.processor.elements.previewImage.src = URL.createObjectURL(blob);

        // Disable crop mode
        this.enabled = false;
        this.elements.toggle.checked = false;
        this.elements.options.classList.add('opacity-50', 'pointer-events-none');
        this.elements.overlay.classList.add('hidden');
        this.rect = { x: 0, y: 0, width: 0, height: 0 };

        await this.processor.process();
        this.processor.hideLoading();
    }

    reset() {
        this.enabled = false;
        this.elements.toggle.checked = false;
        this.elements.options.classList.add('opacity-50', 'pointer-events-none');
        this.elements.overlay.classList.add('hidden');
        this.rect = { x: 0, y: 0, width: 0, height: 0 };
        this.aspectRatio = null;
        this.elements.aspectSelect.value = 'free';
    }

    syncUIState() {
        if (this.elements.toggle.checked) {
            this.elements.options.classList.remove('opacity-50', 'pointer-events-none');
            this.elements.overlay.classList.remove('hidden');
        } else {
            this.elements.options.classList.add('opacity-50', 'pointer-events-none');
            this.elements.overlay.classList.add('hidden');
        }
    }
}

// ============================================================================
// ResizeTool Class
// ============================================================================

class ResizeTool {
    constructor(processor) {
        this.processor = processor;
        this.enabled = false;
        
        this.elements = {
            toggle: document.getElementById('enableResize'),
            options: document.getElementById('resizeOptions'),
            width: document.getElementById('resizeWidth'),
            height: document.getElementById('resizeHeight'),
            maintainAspect: document.getElementById('maintainAspect'),
            method: document.getElementById('resizeMethod'),
            fitMethod: document.getElementById('fitMethod')
        };
        
        this._bindEvents();
    }

    _bindEvents() {
        const { toggle, width, height, method, fitMethod } = this.elements;
        const debouncedProcess = Utils.debounce(() => this.processor.process(), 300);

        toggle.addEventListener('change', () => {
            this._onToggle();
            debouncedProcess();
        });

        width.addEventListener('input', () => {
            this._onWidthChange();
            if (this.enabled) debouncedProcess();
        });

        height.addEventListener('input', () => {
            this._onHeightChange();
            if (this.enabled) debouncedProcess();
        });

        method.addEventListener('change', () => {
            if (this.enabled) debouncedProcess();
        });

        fitMethod.addEventListener('change', () => {
            if (this.enabled) debouncedProcess();
        });
    }

    _onToggle() {
        this.enabled = this.elements.toggle.checked;
        if (this.enabled) {
            this.elements.options.classList.remove('opacity-50', 'pointer-events-none');
        } else {
            this.elements.options.classList.add('opacity-50', 'pointer-events-none');
        }
    }

    _onWidthChange() {
        if (this.elements.maintainAspect.checked && this.processor.aspectRatio) {
            this.elements.height.value = Math.round(this.elements.width.value / this.processor.aspectRatio);
        }
    }

    _onHeightChange() {
        if (this.elements.maintainAspect.checked && this.processor.aspectRatio) {
            this.elements.width.value = Math.round(this.elements.height.value * this.processor.aspectRatio);
        }
    }

    getOptions() {
        return {
            width: parseInt(this.elements.width.value) || this.processor.width,
            height: parseInt(this.elements.height.value) || this.processor.height,
            method: this.elements.method.value,
            fitMethod: this.elements.fitMethod.value,
            premultiply: true,
            linearRGB: true
        };
    }

    reset() {
        this.enabled = false;
        this.elements.toggle.checked = false;
        this.elements.options.classList.add('opacity-50', 'pointer-events-none');
    }

    syncUIState() {
        if (this.elements.toggle.checked) {
            this.elements.options.classList.remove('opacity-50', 'pointer-events-none');
        } else {
            this.elements.options.classList.add('opacity-50', 'pointer-events-none');
        }
    }
}

// ============================================================================
// CompressTool Class
// ============================================================================

class CompressTool {
    constructor(processor) {
        this.processor = processor;
        this.wasmModule = null;
        this.wasmReady = false;
        
        this.elements = {
            quality: document.getElementById('quality'),
            qualityValue: document.getElementById('qualityValue'),
            toggleAdvanced: document.getElementById('toggleAdvanced'),
            advancedOptions: document.getElementById('advancedOptions'),
            advancedArrow: document.getElementById('advancedArrow'),
            autoSubsample: document.getElementById('autoSubsample'),
            separateChromaQuality: document.getElementById('separateChromaQuality'),
            chromaQualityWrapper: document.getElementById('chromaQualityWrapper'),
            chromaQuality: document.getElementById('chromaQuality'),
            chromaQualityValue: document.getElementById('chromaQualityValue'),
            progressive: document.getElementById('progressive'),
            optimizeCoding: document.getElementById('optimizeCoding'),
            smoothing: document.getElementById('smoothing'),
            smoothingValue: document.getElementById('smoothingValue'),
            trellisMultipass: document.getElementById('trellisMultipass'),
            trellisOptZero: document.getElementById('trellisOptZero'),
            trellisOptTable: document.getElementById('trellisOptTable'),
            trellisLoops: document.getElementById('trellisLoops'),
            trellisLoopsValue: document.getElementById('trellisLoopsValue'),
            quantTable: document.getElementById('quantTable')
        };
        
        this._bindEvents();
    }

    async init() {
        if (this.wasmReady) return;
        try {
            console.log('Initializing MozJPEG WASM encoder...');
            const initMozJpegEnc = (await import('./wasm/mozjpeg_enc.js')).default;
            this.wasmModule = await initMozJpegEnc();
            this.wasmReady = true;
            console.log('MozJPEG WASM encoder loaded successfully');
        } catch (error) {
            console.error('Failed to load WASM module:', error);
            throw error;
        }
    }

    _bindEvents() {
        const debouncedProcess = Utils.debounce(() => this.processor.process(), 300);
        const { 
            quality, qualityValue, toggleAdvanced, advancedOptions, advancedArrow,
            separateChromaQuality, chromaQualityWrapper, chromaQuality, chromaQualityValue,
            smoothing, smoothingValue, trellisLoops, trellisLoopsValue,
            progressive, optimizeCoding, autoSubsample, trellisMultipass,
            trellisOptZero, trellisOptTable, quantTable
        } = this.elements;

        // Quality slider
        quality.addEventListener('input', () => {
            qualityValue.textContent = quality.value;
            debouncedProcess();
        });

        // Advanced toggle
        toggleAdvanced.addEventListener('click', () => {
            advancedOptions.classList.toggle('hidden');
            advancedArrow.classList.toggle('rotate-180');
        });

        // Chroma quality toggle
        separateChromaQuality.addEventListener('change', () => {
            chromaQualityWrapper.classList.toggle('hidden', !separateChromaQuality.checked);
            debouncedProcess();
        });

        chromaQuality.addEventListener('input', () => {
            chromaQualityValue.textContent = chromaQuality.value;
            debouncedProcess();
        });

        // Smoothing slider
        smoothing.addEventListener('input', () => {
            smoothingValue.textContent = smoothing.value;
            debouncedProcess();
        });

        // Trellis loops slider
        trellisLoops.addEventListener('input', () => {
            trellisLoopsValue.textContent = trellisLoops.value;
            debouncedProcess();
        });

        // Checkbox options
        [progressive, optimizeCoding, autoSubsample, trellisMultipass, trellisOptZero, trellisOptTable]
            .forEach(el => el.addEventListener('change', debouncedProcess));

        // Quant table
        quantTable.addEventListener('change', debouncedProcess);
    }

    getOptions() {
        const el = this.elements;
        return {
            quality: parseInt(el.quality.value),
            baseline: false,
            arithmetic: false,
            progressive: el.progressive.checked,
            optimize_coding: el.optimizeCoding.checked,
            smoothing: parseInt(el.smoothing.value),
            color_space: 3, // YCbCr
            quant_table: parseInt(el.quantTable.value),
            trellis_multipass: el.trellisMultipass.checked,
            trellis_opt_zero: el.trellisOptZero.checked,
            trellis_opt_table: el.trellisOptTable.checked,
            trellis_loops: parseInt(el.trellisLoops.value),
            auto_subsample: el.autoSubsample.checked,
            chroma_subsample: 2,
            separate_chroma_quality: el.separateChromaQuality.checked,
            chroma_quality: parseInt(el.chromaQuality.value)
        };
    }

    async encode(imageData) {
        if (!this.wasmReady) await this.init();
        return this.wasmModule.encode(imageData.data, imageData.width, imageData.height, this.getOptions());
    }

    reset() {
        this.elements.quality.value = 75;
        this.elements.qualityValue.textContent = '75';
    }

    syncUIState() {
        const el = this.elements;
        el.qualityValue.textContent = el.quality.value;
        el.chromaQualityValue.textContent = el.chromaQuality.value;
        el.smoothingValue.textContent = el.smoothing.value;
        el.trellisLoopsValue.textContent = el.trellisLoops.value;
        el.chromaQualityWrapper.classList.toggle('hidden', !el.separateChromaQuality.checked);
    }
}

// ============================================================================
// ImageProcessor Main Class
// ============================================================================

class ImageProcessor {
    constructor() {
        this.originalFile = null;
        this.imageData = null;
        this.width = 0;
        this.height = 0;
        this.aspectRatio = 1;
        this.compressedBlob = null;
        this.isProcessing = false;
        this.resizeModule = null;

        this.elements = {
            dropZone: document.getElementById('dropZone'),
            imageFileInput: document.getElementById('imageFile'),
            uploadSection: document.getElementById('uploadSection'),
            loadingSection: document.getElementById('loadingSection'),
            editorSection: document.getElementById('editorSection'),
            loadingText: document.getElementById('loadingText'),
            loadingBar: document.getElementById('loadingBar'),
            previewImage: document.getElementById('previewImage'),
            previewContainer: document.getElementById('previewContainer'),
            originalName: document.getElementById('originalName'),
            originalDimensions: document.getElementById('originalDimensions'),
            originalSize: document.getElementById('originalSize'),
            originalType: document.getElementById('originalType'),
            outputSize: document.getElementById('outputSize'),
            outputDimensions: document.getElementById('outputDimensions'),
            sizeSavings: document.getElementById('sizeSavings'),
            viewOriginal: document.getElementById('viewOriginal'),
            viewCompressed: document.getElementById('viewCompressed'),
            downloadBtn: document.getElementById('downloadBtn'),
            resetBtn: document.getElementById('resetBtn')
        };

        // Initialize tools
        this.zoomTool = new ZoomTool(this);
        this.cropTool = new CropTool(this);
        this.resizeTool = new ResizeTool(this);
        this.compressTool = new CompressTool(this);

        this._bindEvents();
        this._initServiceWorker();
        this._syncUIState();
        
        // Pre-initialize WASM
        this.compressTool.init();
        this._loadResizeModule();
    }

    async _loadResizeModule() {
        try {
            this.resizeModule = (await import('./resize/index.js')).default;
            console.log('Resize module loaded');
        } catch (error) {
            console.error('Failed to load resize module:', error);
        }
    }

    _bindEvents() {
        const { dropZone, imageFileInput, viewOriginal, viewCompressed, downloadBtn, resetBtn } = this.elements;

        // Drag & drop
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('border-purple-500', 'bg-purple-50');
        });

        dropZone.addEventListener('dragleave', () => {
            dropZone.classList.remove('border-purple-500', 'bg-purple-50');
        });

        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('border-purple-500', 'bg-purple-50');
            this.loadFile(e.dataTransfer.files[0]);
        });

        // File input
        imageFileInput.addEventListener('change', (e) => {
            this.loadFile(e.target.files[0]);
        });

        // View buttons
        viewOriginal.addEventListener('click', () => this._showOriginal());
        viewCompressed.addEventListener('click', () => this._showCompressed());

        // Action buttons
        downloadBtn.addEventListener('click', () => this.download());
        resetBtn.addEventListener('click', () => this.reset());
    }

    _initServiceWorker() {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('./sw.js')
                .then(reg => console.log('Service Worker registered:', reg.scope))
                .catch(err => console.log('Service Worker registration failed:', err));
        }
    }

    _syncUIState() {
        this.zoomTool.syncUIState();
        this.cropTool.syncUIState();
        this.resizeTool.syncUIState();
        this.compressTool.syncUIState();
    }

    showLoading(text, percent = 0) {
        this.elements.loadingSection.classList.remove('hidden');
        this.elements.loadingText.textContent = text;
        this.elements.loadingBar.style.width = percent + '%';
    }

    hideLoading() {
        this.elements.loadingSection.classList.add('hidden');
    }

    async loadFile(file) {
        if (!file || !file.type.startsWith('image/')) {
            alert('Please select a valid image file');
            return;
        }

        this.originalFile = file;
        this.showLoading('Loading image...', 10);

        try {
            const arrayBuffer = await file.arrayBuffer();
            this.showLoading('Decoding image...', 30);

            this.imageData = await Utils.decodeImageWithCanvas(arrayBuffer, file.type);
            this.width = this.imageData.width;
            this.height = this.imageData.height;
            this.aspectRatio = this.width / this.height;

            this.showLoading('Preparing editor...', 60);

            // Update info
            this.elements.originalName.textContent = file.name;
            this.elements.originalDimensions.textContent = `${this.width} × ${this.height}`;
            this.elements.originalSize.textContent = Utils.formatFileSize(file.size);
            this.elements.originalType.textContent = file.type;

            // Set resize defaults
            this.resizeTool.elements.width.value = this.width;
            this.resizeTool.elements.height.value = this.height;

            // Show preview
            const blob = new Blob([arrayBuffer], { type: file.type });
            this.elements.previewImage.src = URL.createObjectURL(blob);

            this.showLoading('Initial compression...', 80);
            await this.process();

            this.hideLoading();
            this.elements.uploadSection.classList.add('hidden');
            this.elements.editorSection.classList.remove('hidden');

        } catch (error) {
            console.error('Error loading image:', error);
            this.hideLoading();
            alert('Error loading image: ' + error.message);
        }
    }

    async process() {
        if (this.isProcessing) return;
        this.isProcessing = true;

        try {
            let imageData = this.imageData;

            // Resize if enabled
            if (this.resizeTool.enabled && this.resizeModule) {
                const opts = this.resizeTool.getOptions();
                if (opts.width !== imageData.width || opts.height !== imageData.height) {
                    this.showLoading('Resizing image...', 40);
                    imageData = await this.resizeModule(imageData, opts);
                }
            }

            this.showLoading('Compressing image...', 60);
            const compressedBuffer = await this.compressTool.encode(imageData);
            this.compressedBlob = new Blob([compressedBuffer], { type: 'image/jpeg' });

            this.showLoading('Updating preview...', 90);

            // Update preview
            this.elements.previewImage.src = URL.createObjectURL(this.compressedBlob);

            // Update output info
            this.elements.outputSize.textContent = Utils.formatFileSize(this.compressedBlob.size);
            this.elements.outputDimensions.textContent = `${imageData.width} × ${imageData.height}`;

            // Calculate savings
            const savings = ((this.originalFile.size - this.compressedBlob.size) / this.originalFile.size * 100).toFixed(1);
            if (savings > 0) {
                this.elements.sizeSavings.textContent = `(-${savings}%)`;
                this.elements.sizeSavings.className = 'text-sm text-green-600';
            } else {
                this.elements.sizeSavings.textContent = `(+${Math.abs(savings)}%)`;
                this.elements.sizeSavings.className = 'text-sm text-red-600';
            }

            this.hideLoading();

        } catch (error) {
            console.error('Error processing image:', error);
            this.hideLoading();
            alert('Error processing image: ' + error.message);
        } finally {
            this.isProcessing = false;
        }
    }

    _showOriginal() {
        this.elements.viewOriginal.classList.add('bg-purple-600', 'text-white');
        this.elements.viewOriginal.classList.remove('bg-gray-200');
        this.elements.viewCompressed.classList.remove('bg-purple-600', 'text-white');
        this.elements.viewCompressed.classList.add('bg-gray-200');
        this.elements.previewImage.src = URL.createObjectURL(this.originalFile);
    }

    _showCompressed() {
        this.elements.viewCompressed.classList.add('bg-purple-600', 'text-white');
        this.elements.viewCompressed.classList.remove('bg-gray-200');
        this.elements.viewOriginal.classList.remove('bg-purple-600', 'text-white');
        this.elements.viewOriginal.classList.add('bg-gray-200');
        if (this.compressedBlob) {
            this.elements.previewImage.src = URL.createObjectURL(this.compressedBlob);
        }
    }

    download() {
        if (!this.compressedBlob) return;
        const baseName = this.originalFile.name.replace(/\.[^.]+$/, '');
        const link = document.createElement('a');
        link.href = URL.createObjectURL(this.compressedBlob);
        link.download = `${baseName}_compressed.jpg`;
        link.click();
    }

    reset() {
        this.originalFile = null;
        this.imageData = null;
        this.compressedBlob = null;
        
        this.elements.editorSection.classList.add('hidden');
        this.elements.uploadSection.classList.remove('hidden');
        this.elements.imageFileInput.value = '';

        this.zoomTool.reset();
        this.cropTool.reset();
        this.resizeTool.reset();
        this.compressTool.reset();
    }
}

// ============================================================================
// Initialize on DOM ready
// ============================================================================

let imageProcessor;

document.addEventListener('DOMContentLoaded', () => {
    imageProcessor = new ImageProcessor();
    window.imageProcessor = imageProcessor; // Expose for debugging
});

export { ImageProcessor, ZoomTool, CropTool, ResizeTool, CompressTool, Utils };
