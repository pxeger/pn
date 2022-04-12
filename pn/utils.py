class Set:
    def __init__(self):
        self._dict = dict()

    def __iter__(self):
        return iter(self._dict.values())

    def __contains__(self, item):
        return id(item) in self._dict

    def add(self, item):
        self._dict[id(item)] = item

    def remove(self, item):
        del self._dict[id(item)]
