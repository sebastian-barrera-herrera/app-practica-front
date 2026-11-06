class NotFittedError(ValueError, AttributeError):
    """Se usa un estimador antes de entrenarlo."""


class ConvergenceWarning(UserWarning):
    pass


class DataConversionWarning(UserWarning):
    pass


class UndefinedMetricWarning(UserWarning):
    pass


class FitFailedWarning(RuntimeWarning):
    pass


class InconsistentVersionWarning(UserWarning):
    pass
