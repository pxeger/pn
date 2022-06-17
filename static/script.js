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
        // no editing functionality needed on help page
        return;
    }

    const connect = () => {
        const wsURL = new URL(location);
        wsURL.pathname = '/ws';
        wsURL.hash = '';
        wsURL.protocol = wsURL.protocol === 'https:' ? 'wss:' : 'ws:';
        ws = new WebSocket(wsURL);
        ws.onclose = (e) => {
            if (e.code === 1012) {
                // service restart
                location.reload();
                return;
            } else if (e.code === 1001) {
                // browser is navigating away. Changing state now would be confusing
                return;
            }
            document.documentElement.classList.remove('connected');
            if (e.wasClean) {
                alert(`An internal error occured:\n${e.code}\n${e.reason}`);
            } else {
                reconnects += 1;
                if (reconnects < 5) setTimeout(() => connect(), 1000);
                else alert('Websocket connection failed. Check your network connection, and then reload the page.');
            }
        }
        ws.onopen = () => {
            document.documentElement.classList.add('connected');
            reconnects = 0;
            flushMessageQueue();
            setInterval(flushMessageQueue, 200);
        }
        ws.onmessage = (e) => {
            const payload = JSON.parse(e.data);
            for (const message of payload) {
                switch (message.type) {
                    case 'error':
                        alert('An internal error occurred:\n' + message.value);
                        break;
                    case 'set_content':
                        $id(message.id).value = message.content;
                        break;
                    case 'update_tag':
                        addTag($node(message.id), message.tag);
                        break;
                    case 'move':
                        move(message);
                        break;
                    case 'delete':
                        remove($node(message.id));
                        break;
                    case 'create':
                        create(message);
                        break;
                    default:
                        // unknown
                        console.warn('unknown message', message);
                }
            }
        }
    }
    const messageQueue = [];
    let reconnects = 0;
    let ws;
    connect();
    const sendMessage = (message) => {
        messageQueue.push(message);
    }
    const flushMessageQueue = () => {
        const messages = messageQueue.splice(0);
        if (messages.length > 0) {
            ws.send(JSON.stringify(messages));
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

    const create = ({ parent: parentId, content, id, was_you: wasUs, index }) => {
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
        const branch = parent.querySelector('.branch');
        if (index === null) {
            branch.appendChild(newContent);
        } else {
            const relativeTo = branch.children[index];
            if (relativeTo === undefined && index < 0) {
                relativeTo = branch.firstElementChild;
            }
            if (relativeTo === undefined) {
                branch.appendChild(newContent);
            } else {
                branch.insertBefore(newContent, relativeTo);
            }
        }
        addEventListeners(newNode.querySelector('.leaf'));
        if (wasUs) {
            newNode.querySelector('.leaf-text').focus();
        }
    }

    document.addEventListener('dragstart', (event) => {
        const leaf = $parent(event.target, 'leaf');
        const leafText = leaf.querySelector('.leaf-text');
        event.dataTransfer.setData('text/plain', leafText.value);
        event.dataTransfer.setData('application/x-pn-node', leafText.id);
        event.dataTransfer.setDragImage(leaf, 0, event.target.scrollHeight / 2);
    });

    const addTag = (element, tag) => {
        const attribute = /([^=]*)=(.*)/.exec(tag);
        if (attribute) {
            if (attribute[1] === '') {
                element.id = attribute[2];
            } else {
                element.dataset['tag_' + attribute[1]] = attribute[2];
            }
        } else {
            element.dataset['tag_' + tag] = '';
        }
    }

    const visibleChildNodes = (node) => {
        const checkbox = node.querySelector('.checkbox');
        if (!checkbox.checked) return [];
        const branch = node.querySelector('.branch');
        return branch.children;
    }

    const addEventListeners = (leaf) => {
        leaf.querySelectorAll('.leaf-text').forEach(element => {
            element.addEventListener('input', (event) => {
                if (event.isComposing) return;
                let content = event.target.value;
                if (event.data && event.data[event.data.length - 1] === ' ') {
                    let match;
                    let addedTag = false;
                    while ((match = /^#([^\s#]+)\s+(.*)/.exec(content))) {
                        addedTag = true;
                        const tag = match[1];
                        addTag($parent(event.target, 'node'), tag);
                        sendMessage({type: 'update_tag', id: +event.target.id, tag});
                        content = match[2];
                    }
                    if (addedTag) {
                        event.target.value = content;
                        event.target.setSelectionRange(0, 0);
                    }
                }
                sendMessage({type: 'set_content', id: +event.target.id, content});
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
                    case 'Enter': {
                        event.preventDefault();
                        const message = {type: 'create', parent: +event.target.id, index: 0, content: ''};
                        sendMessage(message);
                    } break;
                }
            });
        });
        leaf.addEventListener('dragenter', (event) => {
            const el = $parent(event.target, 'leaf');
            el.classList.add('drag');
        });
        leaf.addEventListener('dragleave', (event) => {
            const el = $parent(event.target, 'leaf');
            el.classList.remove('drag');
            el.classList.remove('drop-top');
            el.classList.remove('drop-bottom');
        });
        leaf.addEventListener('dragover', (event) => {
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
                sendMessage(message);
            }
        });
        leaf.querySelectorAll('.delete').forEach((element) => {
            element.addEventListener('click', (event) => {
                event.preventDefault();
                const node = $parent(event.target, 'node');
                if (node.classList.contains('has-children') && !confirm('Are you sure you want to delete this?')) return;
                const oldParent = $parent(node.parentElement, 'node');
                remove(node);
                updateBranchClass(oldParent);
                const message = {type: 'delete', id: +node.dataset.id};
                sendMessage(message);
            });
        });
        leaf.querySelectorAll('.create').forEach((element) => {
            element.addEventListener('click', (event) => {
                event.preventDefault();
                const id = $parent(event.target, 'node').dataset.id;
                const message = {type: 'create', parent: +id, content: '', index: null};
                sendMessage(message);
            });
        });
    }

    $$('.leaf').forEach(addEventListeners);
})();
