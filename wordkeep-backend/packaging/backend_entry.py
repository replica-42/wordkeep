"""PyInstaller entry point for the HTTP worker."""

from multiprocessing import freeze_support

from wordkeep_backend.interfaces.http import main

if __name__ == "__main__":
    freeze_support()
    main()
