import pytest

from app.schemas.accounts import email_value, normalize_email


@pytest.mark.parametrize(
    "value,expected",
    [
        (" User.Name+test@googlemail.com ", "username@gmail.com"),
        ("USER.name@gmail.COM", "username@gmail.com"),
        ("User.Name+tag@Example.COM", "user.name+tag@example.com"),
        (" user.name@example.com ", "user.name@example.com"),
    ],
)
def test_normalize_exact_domain_rules(value, expected):
    assert email_value(value) == value
    assert normalize_email(value) == expected


@pytest.mark.parametrize(
    "value", ["bad", "a@@gmail.com", "+tag@gmail.com", "user..name@gmail.com", "x\ny@example.com"]
)
def test_email_validation(value):
    with pytest.raises(ValueError):
        email_value(value)
