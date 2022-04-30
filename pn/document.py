from enum import auto, Enum
import re


class Token(Enum):
    indent = auto()
    dedent = auto()


def lex(source):
    line_number = 0
    indentations = [0]

    def error(text):
        text = f"*** ERROR: {text}"
        text += f"\n*** on line {line_number}"
        text += "\n    " + line
        text += "\n***"
        raise SyntaxError(text) from None

    for line in source.splitlines():
        line_number += 1
        if not line.strip():
            continue
        match line.split("-", 1):
            case start, content:
                content = content.strip()
            case _:
                error("missing dash")
        if not all(c == " " for c in start):
            msg = "non-space characters found before dash"
            if "\t" in start:
                msg += " (hint: tabs found!)"
            error(msg)
        indentation = len(start)
        if indentation > indentations[-1]:
            # indent
            indentations.append(indentation)

            yield Token.indent
            yield content
        elif indentation == indentations[-1]:
            # no change in indentation
            yield content
        else:
            # dedent
            try:
                i = indentations.index(indentation)
            except ValueError:
                error("dedent does not match any previous level of indentation")
            for _ in indentations[i + 1:]:
                yield Token.dedent
            indentations = indentations[:i + 1]
            yield content


class Document:
    def __init__(self, source):
        self.source = source
        self.counter = 0
        self.root = Node(0, None, "", set())
        self.nodes = {0: self.root}
        self._parse(lex(source), self.root)

    def id(self):
        self.counter += 1
        return self.counter

    def node(self, *args):
        id = self.id()
        node = Node(id, *args)
        self.nodes[id] = node
        return node

    def _parse(self, tokens, out):
        for token in tokens:
            match token:
                case Token.indent:
                    self._parse(tokens, out[-1])
                case Token.dedent:
                    break
                case string:
                    content, tags = parse_tags(string)
                    out.append(self.node(out, content, tags))

    def set_content(self, id, content):
        self.nodes[id].content = content

    def create_child(self, parent_id, content):
        node = self.node(self.nodes[parent_id], content)
        self.nodes[parent_id].append(node)
        return node

    def delete_node(self, id):
        node = self.nodes[id]
        if self.root[:] == [node]:
            # removing this will remove all children
            return False
        node.parent.remove(node)
        self._delete_nodes(self.nodes[id])
        return True

    def _delete_nodes(self, node):
        for child in node:
            self._delete_nodes(child)
        del self.nodes[node.id]

    def move_up(self, id):
        node = self.nodes[id]
        i = node.parent.index(node)
        if i == 0:
            return False, None, None
        node.parent[i - 1], node.parent[i] = node, node.parent[i - 1]
        return True, node.parent.id, i - 1

    def move_down(self, id):
        node = self.nodes[id]
        if node.parent[-1] is node:
            return False, None, None
        i = node.parent.index(node)
        node.parent[i + 1], node.parent[i] = node, node.parent[i + 1]
        return True, node.parent.id, i + 1

    def move_out(self, id):
        node = self.nodes[id]
        old_parent = node.parent
        if old_parent is self.root:
            # can't move out beyond the root node
            return False, None, None
        new_parent = old_parent.parent
        old_parent.remove(node)
        new_parent.insert(index := new_parent.index(old_parent), node)
        node.parent = new_parent
        return True, new_parent.id, index

    def move(self, id, parent_id, index):
        node = self.nodes[id]
        node.parent.remove(node)
        new_parent = self.nodes[parent_id]
        new_parent.insert(index, node)
        node.parent = new_parent


class Node(list):
    __slots__ = "parent", "id", "content", "tags"

    def __init__(self, id, parent, content, tags=None):
        self.id = id
        self.parent = parent
        self.content = content
        if tags is None:
            tags = set()
        self.tags = tags
        super().__init__()

    def __eq__(self, other):
        return self is other

    def __ne__(self, other):
        return self is not other

    __lt__ = __gt__ = __le__ = __ge__ = lambda _self, _other: NotImplemented

    def is_leaf(self):
        return len(self) == 0

    def is_root(self):
        return self.id == 0

    def __repr__(self):
        l = super().__repr__()
        return f"Node({self.content!r}){l}"

    def serialise(self):
        return {"id": self.id, "content": self.content, "tags": list(self.tags), "children": [c.serialise() for c in self]}

    def save(self, indent: int = 0):
        if self.parent is None:
            return "\n".join(n.save(indent) for n in self)
        return " " * indent + "- " + "".join("#" + tag + " " for tag in self.tags) + self.content + "".join("\n" + n.save(indent + 2) for n in self)


TAG_REGEX = re.compile(r"^#([^\s#]+)\s*(.*)")


def parse_tags(s):
    tags = set()
    while m := TAG_REGEX.match(s):
        tags.add(m[1])
        s = m[2]
    return s, tags
