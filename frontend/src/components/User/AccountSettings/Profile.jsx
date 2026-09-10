import { useState } from "react";

import { Input } from "@/components/ui/input";
import Field from "@/components/app/Field";
import PhoneInput from "@/components/app/PhoneInput";
import { useDraftSection } from "@/components/app/draft-context";
import ImageUpload from "../ImageUpload";
import UserAvatar from "../UserAvatar";

// Секция «Профиль»: hero (аватар · имя · роль + компания · «Сменить фото»)
// и поля учётной записи. Аватар — общий User/UserAvatar (та же плитка, что
// в списке и на карточке; превью после загрузки — пропом `src`). Роль и
// компанию меняет администратор — в hero они только отображаются (словарь
// ролей — как в бургер-меню Navbar).
//
// Своей кнопки у секции нет: правки уходят в черновик страницы, а записывает
// их плашка внизу (app/DraftBar). Фото — исключение: у него свой эндпоинт, и
// оно применяется сразу.
const Profile = ({ user }) => {
  const [firstName, setFirstName] = useState(user.firstName || "");
  const [lastName, setLastName] = useState(user.lastName || "");
  const [email, setEmail] = useState(user.email || "");
  const [phoneNumber, setPhoneNumber] = useState(user.phone || "");
  const [position, setPosition] = useState(user.position || "");
  const [profileImage, setProfileImage] = useState(
    user.profileImagePath
      ? `${import.meta.env.VITE_API_ADDRESS}/uploads/${user.profileImagePath}`
      : null,
  );

  // Пустое обязательное поле бэкенд молча пропустит, оставив прежнее значение,
  // — поэтому причину называем на месте и гасим сохранение до исправления.
  const blank = (value) => !value.trim();
  const blockedReason =
    blank(firstName) || blank(lastName) || blank(email)
      ? "Имя, фамилия и email не могут быть пустыми"
      : null;

  useDraftSection(
    () => ({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim(),
      phone: phoneNumber || "",
      position: position.trim(),
    }),
    blockedReason,
  );

  const roleLabel = user.isAdmin
    ? "Администратор"
    : user.isEndUser
      ? "Пользователь"
      : "Сотрудник";

  return (
    <div className="p-5">
      <div className="mb-5 flex flex-wrap items-center gap-4">
        <UserAvatar
          user={user}
          src={profileImage}
          sizeClass="size-16"
          textClass="text-xl"
        />
        <div className="min-w-0">
          <div className="text-xl leading-snug font-semibold tracking-tight">
            {user.firstName} {user.lastName}
          </div>
          <div className="text-sm text-muted-foreground">
            {roleLabel}
            {user.company?.alias ? ` · ${user.company.alias}` : ""}
          </div>
        </div>
        <div className="ms-auto max-md:ms-0 max-md:w-full">
          <ImageUpload
            userId={user._id.toString()}
            setProfileImage={setProfileImage}
          />
        </div>
      </div>

      <div className="grid gap-x-4 md:grid-cols-2">
        <Field label="Имя" htmlFor="firstName" required>
          <Input
            id="firstName"
            type="text"
            value={firstName}
            aria-invalid={blank(firstName)}
            onChange={(event) => setFirstName(event.target.value)}
          />
        </Field>
        <Field label="Фамилия" htmlFor="lastName" required>
          <Input
            id="lastName"
            type="text"
            value={lastName}
            aria-invalid={blank(lastName)}
            onChange={(event) => setLastName(event.target.value)}
          />
        </Field>
        <Field label="Email" htmlFor="email" required>
          <Input
            id="email"
            type="email"
            value={email}
            aria-invalid={blank(email)}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>
        <Field label="Телефон" htmlFor="phone">
          <PhoneInput
            id="phone"
            value={phoneNumber}
            setValue={setPhoneNumber}
          />
        </Field>
      </div>
      <Field label="Должность" htmlFor="position" className="mb-1">
        <Input
          id="position"
          type="text"
          value={position}
          onChange={(event) => setPosition(event.target.value)}
        />
      </Field>
    </div>
  );
};

export default Profile;
