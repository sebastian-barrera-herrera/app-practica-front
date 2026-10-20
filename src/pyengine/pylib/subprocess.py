"""subprocess (reducido): el simulador no puede lanzar procesos."""

PIPE = -1
STDOUT = -2
DEVNULL = -3

__all__ = ["Popen", "PIPE", "STDOUT", "call", "check_call", "getstatusoutput", "getoutput", "check_output", "run",
           "CalledProcessError", "DEVNULL", "SubprocessError", "TimeoutExpired", "CompletedProcess"]


class SubprocessError(Exception):
    pass


class TimeoutExpired(SubprocessError):
    def __init__(self, cmd, timeout, output=None, stderr=None):
        self.cmd = cmd
        self.timeout = timeout
        self.output = output
        self.stderr = stderr

    def __str__(self):
        return "Command '%s' timed out after %s seconds" % (self.cmd, self.timeout)


class CalledProcessError(SubprocessError):
    def __init__(self, returncode, cmd, output=None, stderr=None):
        self.returncode = returncode
        self.cmd = cmd
        self.output = output
        self.stderr = stderr

    def __str__(self):
        return "Command '%s' returned non-zero exit status %d." % (self.cmd, self.returncode)

    @property
    def stdout(self):
        return self.output

    @stdout.setter
    def stdout(self, value):
        self.output = value


class CompletedProcess:
    def __init__(self, args, returncode, stdout=None, stderr=None):
        self.args = args
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr

    def __repr__(self):
        args = ['args={!r}'.format(self.args), 'returncode={!r}'.format(self.returncode)]
        if self.stdout is not None:
            args.append('stdout={!r}'.format(self.stdout))
        if self.stderr is not None:
            args.append('stderr={!r}'.format(self.stderr))
        return "{}({})".format(type(self).__name__, ', '.join(args))

    def check_returncode(self):
        if self.returncode:
            raise CalledProcessError(self.returncode, self.args, self.stdout, self.stderr)


def _unavailable(args):
    name = args[0] if isinstance(args, (list, tuple)) and args else args
    raise FileNotFoundError(2, 'No such file or directory: ' + repr(name) + ' (en este simulador no se pueden lanzar procesos)')


class Popen:
    def __init__(self, args, *a, **kw):
        _unavailable(args)


def run(*popenargs, input=None, capture_output=False, timeout=None, check=False, **kwargs):
    _unavailable(popenargs[0] if popenargs else kwargs.get('args'))


def call(*popenargs, timeout=None, **kwargs):
    _unavailable(popenargs[0] if popenargs else kwargs.get('args'))


def check_call(*popenargs, **kwargs):
    _unavailable(popenargs[0] if popenargs else kwargs.get('args'))


def check_output(*popenargs, timeout=None, **kwargs):
    _unavailable(popenargs[0] if popenargs else kwargs.get('args'))


def getstatusoutput(cmd, *, encoding=None, errors=None):
    _unavailable(cmd)


def getoutput(cmd, *, encoding=None, errors=None):
    _unavailable(cmd)
