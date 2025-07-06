import { useState } from 'react';
import { useFetcher } from 'react-router';

import Form from 'react-bootstrap/Form';
import Button from 'react-bootstrap/Button';
import Alert from 'react-bootstrap/Alert';
import Row from 'react-bootstrap/Row';
import Col from 'react-bootstrap/Col';

import AlertToast from '../../../UI/AlertToast';

import { RiSaveLine } from 'react-icons/ri';

const Notifications = (props) => {
    const fetcher = useFetcher();
    const { user, initialPrefs } = props;
    const { byTelegram, byEmail } = user.notify;

    const [showMessage, setShowMessage] = useState(false);

    const enabledPersonalNotifications = Object.values(
        initialPrefs.personalNotifications
    ).filter((item) => item);

    const [tgSwitch, setTgSwitch] = useState({
        tgNewTicket: {
            label: 'Новая заявка',
            isActive: byTelegram?.newTicket,
            isVisible: initialPrefs.personalNotifications.newTicket,
        },
        tgRespStateUpdate: {
            label: 'Изменение статуса ответственного за заявку',
            isActive: byTelegram?.respStateUpdate,
            isVisible: initialPrefs.personalNotifications.respStateUpdate,
        },
        tgTicketStateUpdate: {
            label: 'Изменение статуса заявки',
            isActive: byTelegram?.ticketStateUpdate,
            isVisible: initialPrefs.personalNotifications.ticketStateUpdate,
        },
        tgTicketNewComment: {
            label: 'Новые комментарии',
            isActive: byTelegram?.ticketNewComment,
            isVisible: initialPrefs.personalNotifications.ticketNewComment,
        },
        tgScheduledWorks: {
            label: 'Запланированные работы',
            isActive: byTelegram?.scheduledWorks,
            isVisible: initialPrefs.personalNotifications.scheduledWorks,
        },
    });

    const [emailSwitch, setEmailSwitch] = useState({
        emailNewTicket: {
            label: 'Новая заявка',
            isActive: byEmail?.newTicket,
            isVisible: initialPrefs.personalNotifications.newTicket,
        },
        emailRespStateUpdate: {
            label: 'Изменение статуса ответственного за заявку',
            isActive: byEmail?.respStateUpdate,
            isVisible: initialPrefs.personalNotifications.respStateUpdate,
        },
        emailTicketStateUpdate: {
            label: 'Изменение статуса заявки',
            isActive: byEmail?.ticketStateUpdate,
            isVisible: initialPrefs.personalNotifications.ticketStateUpdate,
        },
        emailTicketNewComment: {
            label: 'Новые комментарии',
            isActive: byEmail?.ticketNewComment,
            isVisible: initialPrefs.personalNotifications.ticketNewComment,
        },
        emailScheduledWorks: {
            label: 'Запланированные работы',
            isActive: byEmail?.scheduledWorks,
            isVisible: initialPrefs.personalNotifications.scheduledWorks,
        },
    });

    const tgSwitchHandler = (event) => {
        setTgSwitch({
            ...tgSwitch,
            [event.target.name]: {
                name: tgSwitch[event.target.name].name,
                label: tgSwitch[event.target.name].label,
                isActive: !tgSwitch[event.target.name].isActive,
                isVisible: tgSwitch[event.target.name].isVisible,
            },
        });
    };

    const emailSwitchHandler = (event) => {
        setEmailSwitch({
            ...emailSwitch,
            [event.target.name]: {
                name: emailSwitch[event.target.name].name,
                label: emailSwitch[event.target.name].label,
                isActive: !emailSwitch[event.target.name].isActive,
                isVisible: emailSwitch[event.target.name].isVisible,
            },
        });
    };

    const submitHandler = () => {
        fetcher.submit(fetcher.formData, {
            method: 'post',
            action: '/my-account',
        });
        setShowMessage(true);
    };

    return (
        <>
            <fetcher.Form method='post' onSubmit={submitHandler}>
                <Form.Control
                    hidden={true}
                    name='id'
                    defaultValue={props.user._id}
                />
                {enabledPersonalNotifications.length === 0 && (
                    <Form.Group>
                        <Alert variant='warning'>
                            Уведомления отключены в глобальных настройках
                            приложения. Для их активации обратитесь к
                            администратору.
                        </Alert>
                    </Form.Group>
                )}
                {enabledPersonalNotifications.length > 0 && (
                    <>
                        <Row className='border-bottom mb-3'>
                            <Col>
                                <h1 className='display-6 mb-3'>Telegram</h1>
                                {initialPrefs.telegramNotifications &&
                                    !user.telegramBot?.isActive && (
                                        <Form.Group>
                                            <Alert variant='warning'>
                                                Для отправки уведомлений
                                                подключите Telegram-бот в
                                                разделе Интеграции
                                            </Alert>
                                        </Form.Group>
                                    )}
                                {!initialPrefs.telegramNotifications && (
                                    <Form.Group>
                                        <Alert variant='warning'>
                                            Telegram-уведомления отключены в
                                            глобальных настройках приложения.
                                            Для их активации обратитесь к
                                            администратору.
                                        </Alert>
                                    </Form.Group>
                                )}
                                {Object.entries(tgSwitch)
                                    .filter((item) => item[1].isVisible)
                                    .map((item) => (
                                        <Form.Group
                                            className='mb-3 w-100'
                                            key={item[0]}
                                        >
                                            <Form.Check
                                                type='switch'
                                                label={item[1].label}
                                                name={item[0]}
                                                checked={item[1].isActive}
                                                value={item[1].isActive}
                                                disabled={
                                                    !user.telegramBot
                                                        ?.isActive ||
                                                    !initialPrefs.telegramNotifications
                                                }
                                                onChange={tgSwitchHandler}
                                            />
                                        </Form.Group>
                                    ))}
                            </Col>
                        </Row>
                        <Row className='border-bottom mb-3'>
                            <Col xs='auto'>
                                <h1 className='display-6 mb-3'>E-mail</h1>
                                {!initialPrefs.emailNotifications && (
                                    <Form.Group>
                                        <Alert variant='warning'>
                                            Email-уведомления отключены в
                                            глобальных настройках приложения.
                                            Для их активации обратитесь к
                                            администратору.
                                        </Alert>
                                    </Form.Group>
                                )}
                                {Object.entries(emailSwitch)
                                    .filter((item) => item[1].isVisible)
                                    .map((item) => (
                                        <Form.Group
                                            className='mb-3 w-100'
                                            key={item[0]}
                                        >
                                            <Form.Check
                                                type='switch'
                                                label={item[1].label}
                                                name={item[0]}
                                                checked={item[1].isActive}
                                                value={item[1].isActive}
                                                disabled={
                                                    !initialPrefs.emailNotifications
                                                }
                                                onChange={emailSwitchHandler}
                                            />
                                        </Form.Group>
                                    ))}
                            </Col>
                        </Row>
                        <Row>
                            <Col>
                                <Button
                                    variant='primary'
                                    type='submit'
                                    name='intent'
                                    value='notifications-update'
                                >
                                    <RiSaveLine /> Сохранить
                                </Button>
                            </Col>
                        </Row>
                    </>
                )}
            </fetcher.Form>
            {fetcher.data?.message && (
                <>
                    <AlertToast
                        show={showMessage}
                        setShow={setShowMessage}
                        variant={fetcher.data.error ? 'danger' : 'success'}
                        message={fetcher.data.message}
                    />
                </>
            )}
        </>
    );
};

export default Notifications;
