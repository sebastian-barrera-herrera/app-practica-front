"""platform (reducido): información fija del sistema simulado."""
import collections

uname_result = collections.namedtuple('uname_result', 'system node release version machine')


def system():
    return 'Linux'


def node():
    return 'dev-dojo'


def release():
    return '6.8.0-dojo'


def version():
    return '#1 SMP Dev Dojo'


def machine():
    return 'x86_64'


def processor():
    return 'x86_64'


def uname():
    return uname_result(system(), node(), release(), version(), machine())


def architecture(executable=None, bits='', linkage=''):
    return ('64bit', 'ELF')


def python_version():
    return '3.13.0'


def python_version_tuple():
    return ('3', '13', '0')


def python_implementation():
    return 'CPython'


def python_compiler():
    return 'GCC 13.2.0'


def python_build():
    return ('main', 'Jan  1 2025 00:00:00')


def python_branch():
    return ''


def python_revision():
    return ''


def libc_ver(executable=None, lib='', version='', chunksize=16384):
    return ('glibc', '2.39')


def platform(aliased=False, terse=False):
    if terse:
        return 'Linux-6.8.0-dojo'
    return 'Linux-6.8.0-dojo-x86_64-with-glibc2.39'


def mac_ver(release='', versioninfo=('', '', ''), machine=''):
    return release, versioninfo, machine


def win32_ver(release='', version='', csd='', ptype=''):
    return release, version, csd, ptype
