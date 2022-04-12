import asyncio
import json

from starlette.applications import Starlette
from starlette.responses import PlainTextResponse, RedirectResponse
from starlette.routing import Mount, Route, WebSocketRoute
from starlette.templating import Jinja2Templates
from starlette.staticfiles import StaticFiles

from pn.utils import Set
from pn.document import Document

templates = Jinja2Templates(directory="templates")
template = templates.TemplateResponse


with open("help.txt") as f:
    help_tree = Document(f.read()).root


with open("notes.txt") as f:
    document = Document(f.read())


template_tree = Document("- if you're seeing this, something has gone wrong").root


NO_CACHE_HEADERS = {
    "Cache-Control": "no-store",
}


async def index(request):
    return RedirectResponse("/edit", 307)


async def edit(request):
    return template(
        "view.html",
        {
            "request": request,
            "tree": document.root,
            "edit": True,
            "template_tree": template_tree,
        },
        headers=NO_CACHE_HEADERS
    )


async def view(request):
    return template(
        "view.html",
        {
            "request": request,
            "tree": document.root,
            "edit": False,
        },
        headers=NO_CACHE_HEADERS
    )


async def help(request):
    return template(
        "view.html",
        {
            "request": request,
            "tree": help_tree,
            "edit": False,
            "ishelp": True,
        },
    )


consumers = Set()


def produce(message, origin=None):
    encoded = json.dumps({"type": "message", "value": message})
    tasks = [asyncio.create_task(ws.send_text(encoded)) for ws in consumers if ws is not origin]
    if tasks:
        asyncio.create_task(
            asyncio.wait(
                tasks,
                timeout=5)
        )


async def save(request):
    updates = {}
    for id, content in (await request.form()).items():
        try:
            id = int(id)
        except ValueError:
            return PlainTextResponse("invalid ID\n", 422)
        if id in updates:
            return PlainTextResponse("duplicate ID\n", 422)
        updates[id] = content

    fail = ""
    for id, content in updates.items():
        id = int(id)
        if id not in document.nodes:
            fail = "not found"
        document.set_content(id, content)

    produce([{"type": "set_content", "id": id, "content": content} for id, content in updates.items()])

    if fail:
        return PlainTextResponse(fail, 404)
    else:
        return RedirectResponse("/edit", 303)


async def create(request):
    id = request.path_params["id"]
    content = (await request.form()).get("content", "")
    if id not in document.nodes:
        return PlainTextResponse("not found", 404)
    result = document.create_child(id, content).id
    produce([{"type": "create", "parent": id, "content": content, "id": result}])
    return RedirectResponse(f"/edit#{result}", 303)


async def delete(request):
    id = request.path_params["id"]
    if id not in document.nodes:
        return PlainTextResponse("not found", 404)
    ok = document.delete_node(id)
    if not ok:
        return PlainTextResponse("cannot delete this node", 403)
    produce([{"type": "delete", "id": id}])
    return RedirectResponse("/edit", 303)


async def move_up(request):
    id = request.path_params["id"]
    if id not in document.nodes:
        return PlainTextResponse("not found", 404)
    ok, parent, index = document.move_up(id)
    if not ok:
        return PlainTextResponse("already the first item of its parent", 404)
    produce([{"type": "move", "id": id, "parent": parent, "index": index}])
    return RedirectResponse("/edit", 303)


async def move_down(request):
    id = request.path_params["id"]
    if id not in document.nodes:
        return PlainTextResponse("not found", 404)
    ok, parent, index = document.move_down(id)
    if not ok:
        return PlainTextResponse("already the last item of its parent", 404)
    produce([{"type": "move", "id": id, "parent": parent, "index": index}])
    return RedirectResponse("/edit", 303)


async def move_out(request):
    id = request.path_params["id"]
    if id not in document.nodes:
        return PlainTextResponse("not found", 404)
    ok, parent, index = document.move_out(id)
    if not ok:
        return PlainTextResponse("cannot move out of the root node", 404)
    produce([{"type": "move", "id": id, "parent": parent, "index": index}])
    return RedirectResponse("/edit", 303)


async def websocket_route(ws):
    await ws.accept()
    consumers.add(ws)
    try:
        async for message in ws.iter_json():
            match message:
                case {"type": "set_content", "id": int() as id, "content": str() as content}:
                    if id not in document.nodes:
                        await ws.send_json({"type": "error", "value": f"node ID {id} not found"})
                    else:
                        document.set_content(id, content)
                        produce(message, ws)
                case {"type": "move", "id": int() as id, "parent": int() as parent_id, "index": int() as index} if index >= 0:
                    if parent_id not in document.nodes:
                        await ws.send_json({"type": "error", "value": f"node ID {parent_id} not found"})
                    elif id not in document.nodes:
                        await ws.send_json({"type": "error", "value": f"node ID {id} not found"})
                    else:
                        document.move(id, parent_id, index)
                        produce(message, ws)
                case {"type": "create", "parent": int() as id, "content": str() as content}:
                    if id not in document.nodes:
                        await ws.send_json({"type": "error", "value": f"node ID {id} not found"})
                    else:
                        result = document.create_child(id, content).id
                        message["id"] = result
                        produce(message, ws)
                        # note: client doesn't know ID of new node, so we send the message to them too
                        await ws.send_json({"type": "message", "value": message | {"was_you": True}})
                case {"type": "delete", "id": int() as id}:
                    if id not in document.nodes:
                        await ws.send_json({"type": "error", "value": f"node ID {id} not found"})
                    else:
                        ok = document.delete_node(id)
                        if ok:
                            produce(message, ws)
                        else:
                            await ws.send_json({"type": "error", "value": "cannot delete this node"})
                case _:
                    return await ws.close(1008, "invalid message")
    finally:
        consumers.remove(ws)


routes = [
    Route("/", endpoint=index, methods={"GET"}),
    Route("/edit", endpoint=edit, methods={"GET"}),
    Route("/view", endpoint=view, methods={"GET"}),
    Route("/help", endpoint=help, methods={"GET"}),
    Route("/save", endpoint=save, methods={"POST"}),
    Route("/create/{id:int}", endpoint=create, methods={"POST"}),
    Route("/delete/{id:int}", endpoint=delete, methods={"POST"}),
    Route("/move_up/{id:int}", endpoint=move_up, methods={"POST"}),
    Route("/move_down/{id:int}", endpoint=move_down, methods={"POST"}),
    Route("/move_out/{id:int}", endpoint=move_out, methods={"POST"}),
    WebSocketRoute("/ws", endpoint=websocket_route),
    Mount("/static", StaticFiles(directory="static")),
]

app = Starlette(routes=routes)
