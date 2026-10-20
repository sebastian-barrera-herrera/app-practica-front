"""getpass (reducido): el «usuario» del simulador y lectura de contraseñas con input()."""
import os

__all__ = ["getpass", "getuser", "GetPassWarning"]


class GetPassWarning(UserWarning):
    pass


def getuser():
    for name in ('LOGNAME', 'USER', 'LNAME', 'USERNAME'):
        user = os.environ.get(name)
        if user:
            return user
    return 'alumno'


def getpass(prompt='Password: ', stream=None):
    return input(prompt)
