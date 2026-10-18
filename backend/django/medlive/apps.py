from django.apps import AppConfig


class MedliveConfig(AppConfig):
    name = "medlive"
    verbose_name = "MedLiveBD API"
    default_auto_field = "django.db.models.BigAutoField"

    def ready(self) -> None:
        # The loaders that make values arrive as the Node driver gave them.
        from .core import db  # noqa: F401
