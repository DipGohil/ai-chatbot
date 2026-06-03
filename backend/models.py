from sqlalchemy import (
    Column,
    Integer,
    String,
    Text
)

from sqlalchemy.orm import declarative_base

Base = declarative_base()

class ChatHistory(Base):
    __tablename__ = "chat_history"

    id = Column(Integer, primary_key=True, index=True)
    question = Column(Text, nullable=False)
    answer = Column(Text)

class Conversation(Base):

    __tablename__ = "conversation"

    id = Column(Integer, primary_key=True)

    session_id = Column(String)

    role = Column(String)

    message = Column(Text)

class Session(Base):

    __tablename__ = "sessions"

    id = Column(Integer, primary_key=True)

    session_id = Column(String, unique=True)

    title = Column(String)
