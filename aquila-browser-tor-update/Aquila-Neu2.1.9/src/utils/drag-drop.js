const fs_drop = require('fs');
const path_drop = require('path');
const { webUtils: webUtils_drop } = require('electron');

const SUPPORTED_DROP_EXTENSIONS = [
    '.pdf', '.html', '.htm', '.svg', '.txt', '.xml', '.json',
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.tiff', '.tif', '.avif',
    '.mp3', '.mp4', '.webm', '.ogg', '.wav', '.m4a', '.flac', '.aac', '.opus',
    '.mov', '.mkv', '.avi', '.m4v', '.3gp'
];

let dropDragCounter = 0;
let dropIndicatorEl = null;

function isSupportedDropFile(filename) {
    const ext = path_drop.extname(filename || '').toLowerCase();
    return SUPPORTED_DROP_EXTENSIONS.includes(ext);
}

function getFilePath(file) {
    if (webUtils_drop && typeof webUtils_drop.getPathForFile === 'function') {
        try {
            return webUtils_drop.getPathForFile(file);
        } catch (e) {}
    }
    if (file.path) return file.path;
    return null;
}

function createDropIndicator() {
    const existing = document.getElementById('pdf-drop-indicator');
    if (existing) existing.remove();

    dropIndicatorEl = document.createElement('div');
    dropIndicatorEl.className = 'pdf-drop-indicator';
    dropIndicatorEl.id = 'pdf-drop-indicator';
    dropIndicatorEl.textContent = 'Datei hier ablegen zum Öffnen';
    document.body.appendChild(dropIndicatorEl);
}

function showDropOverlay() {
    if (dropIndicatorEl && !dropIndicatorEl.classList.contains('active')) {
        dropIndicatorEl.classList.add('active');
    }
}

function hideDropOverlay() {
    if (dropIndicatorEl) {
        dropIndicatorEl.classList.remove('active');
    }
    dropDragCounter = 0;
}

function buildFileUrl(filePath) {
    const resolved = path_drop.resolve(filePath);
    const normalized = resolved.replace(/\\/g, '/');
    if (normalized.startsWith('/')) return 'file://' + normalized;
    return 'file:///' + normalized;
}

function openDroppedFiles(fileList) {
    let opened = false;

    for (let i = 0; i < fileList.length; i++) {
        const file = fileList[i];
        const filePath = getFilePath(file);

        if (!filePath) continue;
        if (!isSupportedDropFile(file.name)) continue;

        try {
            if (!fs_drop.existsSync(filePath)) continue;
        } catch (e) {
            continue;
        }

        const fileUrl = buildFileUrl(filePath);

        if (typeof createTab === 'function') {
            createTab(fileUrl);
            opened = true;
        } else if (window.createTab) {
            window.createTab(fileUrl);
            opened = true;
        }
    }

    return opened;
}

function isTabCurrentlyDragging() {
    return (typeof draggingTabId !== 'undefined' && draggingTabId !== null);
}

function hasFiles(e) {
    if (e.dataTransfer && e.dataTransfer.types) {
        return Array.from(e.dataTransfer.types).includes('Files');
    }
    return false;
}

function initDragDrop() {
    createDropIndicator();

    window.addEventListener('dragenter', function(e) {
        if (isTabCurrentlyDragging()) return;
        if (!hasFiles(e)) return;
        dropDragCounter++;
        if (dropDragCounter === 1) showDropOverlay();
    }, true);

    window.addEventListener('dragleave', function(e) {
        if (isTabCurrentlyDragging()) return;
        dropDragCounter--;
        if (dropDragCounter <= 0) hideDropOverlay();
    }, true);

    window.addEventListener('dragover', function(e) {
        if (isTabCurrentlyDragging()) return;
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
    }, true);

    window.addEventListener('drop', function(e) {
        if (isTabCurrentlyDragging()) return;

        hideDropOverlay();

        if (!e.dataTransfer || !e.dataTransfer.files || e.dataTransfer.files.length === 0) return;

        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        openDroppedFiles(e.dataTransfer.files);
    }, true);
}