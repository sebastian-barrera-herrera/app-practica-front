"""locale (versión reducida: siempre la configuración «C»)."""
LC_CTYPE, LC_NUMERIC, LC_TIME, LC_COLLATE, LC_MONETARY, LC_MESSAGES, LC_ALL = 0, 1, 2, 3, 4, 5, 6
CHAR_MAX = 127


class Error(Exception):
    pass


def setlocale(category, locale=None):
    return 'C'


def getlocale(category=LC_CTYPE):
    return (None, None)


def getdefaultlocale(envvars=()):
    return (None, None)


def getpreferredencoding(do_setlocale=True):
    return 'UTF-8'


def getencoding():
    return 'UTF-8'


def localeconv():
    return {'decimal_point': '.', 'thousands_sep': '', 'grouping': [], 'int_curr_symbol': '', 'currency_symbol': '',
            'mon_decimal_point': '', 'mon_thousands_sep': '', 'mon_grouping': [], 'positive_sign': '', 'negative_sign': '',
            'int_frac_digits': 127, 'frac_digits': 127, 'p_cs_precedes': 127, 'p_sep_by_space': 127,
            'n_cs_precedes': 127, 'n_sep_by_space': 127, 'p_sign_posn': 127, 'n_sign_posn': 127}


def format_string(f, val, grouping=False, monetary=False):
    return f % val


def format(percent, value, grouping=False, monetary=False, *additional):
    return percent % value


def currency(val, symbol=True, grouping=False, international=False):
    return ('$' if symbol else '') + '%.2f' % val


def str(val):
    return '%.12g' % val


def atof(string, func=float):
    return func(string)


def atoi(string):
    return int(string)


def normalize(localename):
    return localename


def strcoll(a, b):
    return (a > b) - (a < b)


def strxfrm(s):
    return s


def resetlocale(category=LC_ALL):
    pass
