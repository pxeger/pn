(() => {'use strict';
    const $ = document.querySelector.bind(document);
    const $$ = document.querySelectorAll.bind(document);
    const $id = document.getElementById.bind(document);
    const $parent = (element, className) => {
        while (!element.classList.contains(className)) {
            element = element.parentElement;
        }
        return element;
    }
    const $node = (id) => $parent($id(id), 'node');

    $('#fullscreen').addEventListener('click', () => $('#root').requestFullscreen());

    if (location.pathname == '/help') {
        return;
    }

    // list of changed elements
    let queue = new Set();

    const flush = () => {
        const oldQueue = queue;
        queue = new Set();
        oldQueue.forEach(element => {
            ws.send(JSON.stringify({type: 'set_content', id: +element.id, content: element.value}));
        });
    }

    let isConnected = false;

    const wsURL = new URL(window.location);
    wsURL.pathname = '/ws';
    wsURL.hash = '';
    wsURL.protocol = wsURL.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(wsURL);
    ws.onerror = () => {
        alert('Failed to connect to the server. Your changes are not being saved automatically');
        document.documentElement.classList.remove('connected');
        isConnected = false;
    }
    ws.onclose = (e) => {
        document.documentElement.classList.remove('connected');
        if (e.code === 1008) {
            console.error('websocket error 1008', e.reason);
            alert('An internal error occurred');
        }
        setTimeout(() => location.reload(), 1000);
        isConnected = false;
    }
    ws.onopen = () => {
        document.documentElement.classList.add('connected');
        setInterval(flush, 500 /* milliseconds */);
        isConnected = true;
    }
    ws.onmessage = (e) => {
        const payload = JSON.parse(e.data);
        switch(payload.type) {
            case 'error':
                alert(payload.value);
                break;
            case 'message':
                switch (payload.value.type) {
                    case 'set_content':
                        $id(payload.value.id).value = payload.value.content;
                        break;
                    case 'move':
                        move(payload.value);
                        break;
                    case 'delete':
                        remove($node(payload.value.id));
                        break;
                    case 'create':
                        create(payload.value);
                        break;
                }
                break;
        }
    }

    const updateBranchClass = (node) => {
        if (node.querySelector('.branch').children.length === 0) {
            node.classList.remove('has-children');
            node.classList.add('empty');
        } else {
            node.classList.remove('empty');
            node.classList.add('has-children');
        }
    }

    const remove = (node) => {
        const parent = $parent(node.parentElement, 'node')
        node.remove();
        updateBranchClass(parent);
    }

    const move = ({ id, parent: parentId, index }) => {
        const node = $node(id);
        const oldParent = $parent(node.parentElement, 'node');
        const parent = $node(parentId);
        const branch = parent.querySelector('.branch');
        node.remove();
        const target = [...branch.children][index];
        if (target === undefined) { // out of bounds: move to end
            branch.appendChild(node);
        } else {
            branch.insertBefore(node, target);
        }
        updateBranchClass(oldParent);
        updateBranchClass(parent);
    }

    const create = ({ parent: parentId, content, id, was_you: wasUs }) => {
        const newContent = $id('new_node').content.cloneNode(true);
        const newNode = newContent.querySelector('.node');
        newContent.querySelector('.node').dataset.id = id;
        newContent.querySelector('.node > .checkbox').id = newNode.querySelector('.collapse').id = `cb_${id}`;
        newContent.querySelector('.controls-checkbox').id = newNode.querySelector('.controls-label').htmlFor = `cc_${id}`;
        newContent.querySelector('.leaf-text').id = newNode.querySelector('.leaf-text').name = id;
        newContent.querySelector('.leaf-text').value = content;
        const parent = $node(parentId);
        parent.classList.remove('empty');
        parent.classList.add('has-children');
        parent.querySelector('.branch').appendChild(newContent);
        addEventListeners(newNode.querySelector('.leaf'));
        if (wasUs) {
            newNode.querySelector('.leaf-text').focus();
        }
    }

    document.addEventListener('dragstart', (event) => {
        if (!isConnected) {
            return;
        }
        const leaf = $parent(event.target, 'leaf');
        const leafText = leaf.querySelector('.leaf-text');
        event.dataTransfer.setData('text/plain', leafText.value);
        event.dataTransfer.setData('application/x-pn-node', leafText.id);
        event.dataTransfer.setDragImage(leaf, 0, event.target.scrollHeight / 2);
    });

    const visibleChildNodes = (node) => {
        const checkbox = node.querySelector('.checkbox');
        if (!checkbox.checked) return [];
        const branch = node.querySelector('.branch');
        return branch.children;
    }

    const addEventListeners = (leaf) => {
        leaf.querySelectorAll('.leaf-text').forEach(element => {
            element.addEventListener('input', (event) => {
                if (!isConnected) return;
                if (event.isComposing) return;
                queue.add(event.target);
            });
            element.addEventListener('keydown', (event) => {
                // avoid intefering with system shortcuts
                if (event.isComposing || event.metaKey || event.altKey || event.ctrlKey) return;
                switch (event.code) {
                    case 'ArrowUp': {
                        event.preventDefault();
                        const target = $parent(event.target, 'node');
                        let newTarget = target.previousElementSibling;
                        if (!newTarget) {
                            newTarget = $parent(target.parentElement, 'node');
                            if (newTarget.id === 'root') return; // root node has no leaf, so can't focus there
                        } else {
                            let children = visibleChildNodes(newTarget);
                            while (children.length > 0) {
                                newTarget = children[children.length - 1];
                                children = visibleChildNodes(newTarget);
                            }
                        }
                        newTarget.querySelector('.leaf-text').focus();
                    } break;
                    case 'ArrowDown': {
                        event.preventDefault();
                        const target = $parent(event.target, 'node');
                        const children = visibleChildNodes(target);
                        let newTarget;
                        if (children.length === 0) {
                            newTarget = target;
                            while (!newTarget.nextElementSibling) {
                                newTarget = $parent(newTarget.parentElement, 'node');
                                if (newTarget.id === 'root') return;  // root node has no parent, so we must be at the end of the list
                            }
                            newTarget = newTarget.nextElementSibling;
                        } else {
                            newTarget = children[0];
                        }
                        newTarget.querySelector('.leaf-text').focus();
                    } break;
                }
            });
        });
        leaf.addEventListener('dragenter', (event) => {
            if (!isConnected) return;
            const el = $parent(event.target, 'leaf');
            el.classList.add('drag');
        });
        leaf.addEventListener('dragleave', (event) => {
            if (!isConnected) return;
            const el = $parent(event.target, 'leaf');
            el.classList.remove('drag');
            el.classList.remove('drop-top');
            el.classList.remove('drop-bottom');
        });
        leaf.addEventListener('dragover', (event) => {
            if (!isConnected) return;
            const el = $parent(event.target, 'leaf');
            if (event.offsetY <= el.scrollHeight / 2) {
                el.classList.remove('drop-bottom');
                el.classList.add('drop-top');
            } else {
                el.classList.remove('drop-top');
                el.classList.add('drop-bottom');
            }
        });
        leaf.addEventListener('drop', (event) => {
            event.preventDefault();
            if (!isConnected) return;
            const el = $parent(event.target, 'leaf');
            el.classList.remove('drag');
            el.classList.remove('drop-top');
            el.classList.remove('drop-bottom');
            const id = event.dataTransfer.getData('application/x-pn-node');
            const dragged = $node(id);
            const draggedTo = $parent(el, 'node');
            if (dragged === draggedTo) return;
            else {
                const oldParent = $parent(dragged.parentElement, 'node');
                dragged.remove();
                const position = event.offsetY <= el.scrollHeight / 2 ? 'beforebegin' : 'afterend';
                draggedTo.insertAdjacentElement(position, dragged);
                const newParent = $parent(dragged.parentElement, 'node');
                updateBranchClass(oldParent);
                updateBranchClass(newParent);
                const index = [...dragged.parentElement.children].indexOf(dragged);
                const parentId = $parent(dragged.parentElement, 'node').dataset.id;
                const message = {type: 'move', id: +id, index, parent: +parentId}
                ws.send(JSON.stringify(message));
            }
        });
        leaf.querySelectorAll('.delete').forEach((element) => {
            element.addEventListener('click', (event) => {
                if (!isConnected) return;
                event.preventDefault();
                if (!confirm('Are you sure you want to delete this?')) return;
                const node = $parent(event.target, 'node');
                const oldParent = $parent(node.parentElement, 'node');
                remove(node);
                updateBranchClass(oldParent);
                const message = {type: 'delete', id: +node.dataset.id};
                ws.send(JSON.stringify(message));
            });
        });
        leaf.querySelectorAll('.create').forEach((element) => {
            element.addEventListener('click', (event) => {
                if (!isConnected) return;
                event.preventDefault();
                const id = $parent(event.target, 'node').dataset.id;
                const message = {type: 'create', parent: +id, content: ''};
                ws.send(JSON.stringify(message));
            });
        });
    }

    $$('.leaf').forEach(addEventListeners);
})();
