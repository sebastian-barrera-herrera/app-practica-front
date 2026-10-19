"""gettext (stub): sin traducciones, devuelve los mensajes originales."""
__all__ = ['gettext', 'ngettext', 'dgettext', 'dngettext', 'pgettext', 'npgettext', 'install', 'translation',
           'NullTranslations', 'GNUTranslations', 'textdomain', 'bindtextdomain', 'find']


def gettext(message):
    return message


def dgettext(domain, message):
    return message


def ngettext(msgid1, msgid2, n):
    return msgid1 if n == 1 else msgid2


def dngettext(domain, msgid1, msgid2, n):
    return ngettext(msgid1, msgid2, n)


def pgettext(context, message):
    return message


def npgettext(context, msgid1, msgid2, n):
    return ngettext(msgid1, msgid2, n)


def textdomain(domain=None):
    return 'messages'


def bindtextdomain(domain, localedir=None):
    return localedir


def find(domain, localedir=None, languages=None, all=False):
    return [] if all else None


class NullTranslations:
    def __init__(self, fp=None):
        pass

    def gettext(self, message):
        return message

    def ngettext(self, msgid1, msgid2, n):
        return ngettext(msgid1, msgid2, n)

    def install(self, names=None):
        import builtins
        builtins.__dict__['_'] = self.gettext


GNUTranslations = NullTranslations


def translation(domain, localedir=None, languages=None, class_=None, fallback=False):
    if fallback:
        return NullTranslations()
    raise FileNotFoundError(2, 'No translation file found for domain', domain)


def install(domain, localedir=None, *, names=None):
    NullTranslations().install(names)
