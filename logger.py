import logging
import sys
from pathlib import Path
from logging.handlers import RotatingFileHandler

LOG_DIR = Path("logs")
LOG_DIR.mkdir(exist_ok=True)

formatter = logging.Formatter(
    fmt="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)

# Console handler 
console_handler = logging.StreamHandler(sys.stdout)
console_handler.setFormatter(formatter)
console_handler.setLevel(logging.DEBUG)

#Main system log (ALL logs) 
main_file_handler = RotatingFileHandler(
    LOG_DIR / "healthline.log",
    maxBytes=5_000_000,
    backupCount=3,
    encoding="utf-8"
)
main_file_handler.setFormatter(formatter)
main_file_handler.setLevel(logging.DEBUG)

#Root logger ==
logger = logging.getLogger("healthline")
logger.setLevel(logging.DEBUG)
logger.addHandler(console_handler)
logger.addHandler(main_file_handler)
logger.propagate = False


#    Helper to create module loggers 
def create_module_logger(name):
    module_logger = logger.getChild(name)

    file_handler = RotatingFileHandler(
        LOG_DIR / f"{name}.log",
        maxBytes=2_000_000,
        backupCount=2,
        encoding="utf-8"
    )

    file_handler.setFormatter(formatter)
    file_handler.setLevel(logging.DEBUG)

    module_logger.addHandler(file_handler)

    return module_logger


# Module loggers
auth_logger = create_module_logger("auth")
