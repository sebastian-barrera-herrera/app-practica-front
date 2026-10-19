"""Versión reducida de _strptime: time.strptime y datetime.strptime."""
import re
import time as _time

_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
_MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october',
           'november', 'december']

_DIRECTIVES = {
    'Y': r'(?P<Y>\d{4})',
    'y': r'(?P<y>\d\d)',
    'm': r'(?P<m>1[0-2]|0[1-9]|[1-9])',
    'd': r'(?P<d>3[0-1]|[1-2]\d|0[1-9]|[1-9]| [1-9])',
    'H': r'(?P<H>2[0-3]|[0-1]\d|\d)',
    'I': r'(?P<I>1[0-2]|0[1-9]|[1-9])',
    'M': r'(?P<M>[0-5]\d|\d)',
    'S': r'(?P<S>6[0-1]|[0-5]\d|\d)',
    'f': r'(?P<f>[0-9]{1,6})',
    'j': r'(?P<j>36[0-6]|3[0-5]\d|[1-2]\d\d|0[1-9]\d|00[1-9]|[1-9]\d|0[1-9]|[1-9])',
    'p': r'(?P<p>am|pm)',
    'A': r'(?P<A>' + '|'.join(_DAYS) + ')',
    'a': r'(?P<a>' + '|'.join(d[:3] for d in _DAYS) + ')',
    'B': r'(?P<B>' + '|'.join(_MONTHS) + ')',
    'b': r'(?P<b>' + '|'.join(m[:3] for m in _MONTHS) + ')',
    'z': r'(?P<z>[+-]\d\d:?[0-5]\d(:?[0-5]\d(\.\d{1,6})?)?|(?-i:Z))',
    'Z': r'(?P<Z>[A-Za-z]+)',
    'w': r'(?P<w>[0-6])',
    '%': '%',
}
_DIRECTIVES['c'] = None


def _expand(fmt):
    fmt = fmt.replace('%c', '%a %b %d %H:%M:%S %Y').replace('%x', '%m/%d/%y').replace('%X', '%H:%M:%S')
    fmt = fmt.replace('%D', '%m/%d/%y').replace('%F', '%Y-%m-%d').replace('%T', '%H:%M:%S').replace('%R', '%H:%M')
    return fmt


def _compile(fmt):
    fmt = _expand(fmt)
    out = []
    i = 0
    while i < len(fmt):
        c = fmt[i]
        if c == '%':
            i += 1
            if i >= len(fmt):
                raise ValueError("stray %% in format '%s'" % fmt)
            d = fmt[i]
            if d not in _DIRECTIVES or _DIRECTIVES[d] is None:
                raise ValueError("'%s' is a bad directive in format '%s'" % (d, fmt))
            out.append(_DIRECTIVES[d])
        elif c.isspace():
            out.append(r'\s+')
        else:
            out.append(re.escape(c))
        i += 1
    return re.compile(''.join(out), re.IGNORECASE)


def _parse(data_string, format):
    for index, arg in enumerate([data_string, format]):
        if not isinstance(arg, str):
            msg = "strptime() argument {} must be str, not {}"
            raise TypeError(msg.format(index, type(arg)))
    rx = _compile(format)
    found = rx.match(data_string)
    if not found:
        raise ValueError("time data %r does not match format %r" % (data_string, format))
    if len(data_string) != found.end():
        raise ValueError("unconverted data remains: %s" % data_string[found.end():])
    g = found.groupdict()
    year = 1900
    month = day = 1
    hour = minute = second = fraction = 0
    tz = -1
    gmtoff = None
    gmtoff_fraction = 0
    weekday = julian = None
    tzname = None
    pm = None
    for k, v in g.items():
        if v is None:
            continue
        if k == 'y':
            year = int(v)
            year += 2000 if year <= 68 else 1900
        elif k == 'Y':
            year = int(v)
        elif k == 'm':
            month = int(v)
        elif k == 'B':
            month = _MONTHS.index(v.lower()) + 1
        elif k == 'b':
            month = [m[:3] for m in _MONTHS].index(v.lower()) + 1
        elif k == 'd':
            day = int(v)
        elif k == 'H':
            hour = int(v)
        elif k == 'I':
            hour = int(v) % 12
        elif k == 'p':
            pm = v.lower() == 'pm'
        elif k == 'M':
            minute = int(v)
        elif k == 'S':
            second = int(v)
        elif k == 'f':
            fraction = int(v.ljust(6, '0'))
        elif k == 'A':
            weekday = _DAYS.index(v.lower())
        elif k == 'a':
            weekday = [d[:3] for d in _DAYS].index(v.lower())
        elif k == 'w':
            weekday = (int(v) - 1) % 7
        elif k == 'j':
            julian = int(v)
        elif k == 'z':
            if v.lower() == 'z':
                gmtoff = 0
            else:
                z = v.replace(':', '')
                sign = -1 if z[0] == '-' else 1
                gmtoff = sign * (int(z[1:3]) * 3600 + int(z[3:5]) * 60)
        elif k == 'Z':
            tzname = v
    if pm is not None:
        hour = hour % 12 + (12 if pm else 0)
    import datetime as _dt
    leap = year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)
    if julian is not None:
        d = _dt.date(year, 1, 1) + _dt.timedelta(days=julian - 1)
        month, day = d.month, d.day
    d = _dt.date(year, month, day)
    if weekday is None:
        weekday = d.weekday()
    if julian is None:
        julian = d.toordinal() - _dt.date(year, 1, 1).toordinal() + 1
    return (year, month, day, hour, minute, second, weekday, julian, tz, tzname, gmtoff), fraction, gmtoff_fraction


def _strptime_time(data_string, format="%a %b %d %H:%M:%S %Y"):
    tt = _parse(data_string, format)[0]
    return _time.struct_time(tt[:9])


def _strptime(data_string, format="%a %b %d %H:%M:%S %Y"):
    return _parse(data_string, format)


def _strptime_datetime(cls, data_string, format="%a %b %d %H:%M:%S %Y"):
    tt, fraction, gmtoff_fraction = _parse(data_string, format)
    tzname, gmtoff = tt[-2:]
    args = tt[:6] + (fraction,)
    if gmtoff is not None:
        from datetime import timedelta, timezone
        tzdelta = timedelta(seconds=gmtoff, microseconds=gmtoff_fraction)
        tz = timezone(tzdelta, tzname) if tzname else timezone(tzdelta)
        args += (tz,)
    return cls(*args)
