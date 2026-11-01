import uuid
from datetime import datetime
from sqlalchemy import String, DateTime, ForeignKey, Float, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship
from database import Base

class Room(Base):
    __tablename__ = "rooms"
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(12), unique=True, index=True)
    video_id: Mapped[str] = mapped_column(String(32), default="dQw4w9WgXcQ")
    is_playing: Mapped[bool] = mapped_column(Boolean, default=False)
    current_time: Mapped[float] = mapped_column(Float, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    members = relationship("Member", back_populates="room", cascade="all, delete-orphan")

class Member(Base):
    __tablename__ = "members"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    room_id: Mapped[int] = mapped_column(ForeignKey("rooms.id", ondelete="CASCADE"))
    username: Mapped[str] = mapped_column(String(40))
    role: Mapped[str] = mapped_column(String(20), default="Participant")
    room = relationship("Room", back_populates="members")
