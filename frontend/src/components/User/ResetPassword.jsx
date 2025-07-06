import { useState } from 'react';
import { useFetcher } from 'react-router';

import { RiSaveLine, RiLock2Line } from 'react-icons/ri';

import Modal from 'react-bootstrap/Modal';
import Button from 'react-bootstrap/Button';
import Form from 'react-bootstrap/Form';
import Alert from 'react-bootstrap/Alert';
import AlertToast from '../../UI/AlertToast';

const ResetPassword = (props) => {
    const fetcher = useFetcher();

    const [validated, setValidated] = useState(true);
    const [show, setShow] = useState(false);
    const handleClose = () => setShow(false);
    const handleShow = () => setShow(true);

    const [enteredPassword, setEnteredPassword] = useState('');
    const [enteredRepeatedPassword, setEnteredRepeatedPassword] = useState('');
    const [sendPassword, setSendPassword] = useState(false);
    const [showMessage, setShowMessage] = useState(false);

    const passwordChangeHandler = (event) => {
        setEnteredPassword(event.target.value);
    };

    const repeatedPasswordChangeHandler = (event) => {
        setEnteredRepeatedPassword(event.target.value);
    };

    const sendPasswordChangeHandler = () => {
        setSendPassword(!sendPassword);
    };

    const submitHandler = (event) => {
        event.preventDefault();
        if (
            enteredPassword !== enteredRepeatedPassword ||
            enteredPassword.trim() === ''
        ) {
            setValidated(false);
            return;
        }

        setValidated(true);

        fetcher.submit(
            {
                intent: 'reset-password',
                id: props.user._id,
                password: enteredPassword,
                repeatedPassword: enteredRepeatedPassword,
                sendPassword: sendPassword,
            },
            { method: 'POST', action: `/users/${props.user._id}` }
        );

        setEnteredPassword('');
        setEnteredRepeatedPassword('');
        setSendPassword(false);

        setShowMessage(true);

        handleClose();
    };

    return (
        <>
            <Button
                variant='primary'
                onClick={handleShow}
                className=' mb-2 w-100'
            >
                <RiLock2Line /> Сбросить пароль
            </Button>
            <Modal show={show} onHide={handleClose}>
                <Modal.Header closeButton>
                    <Modal.Title>Смена пароля</Modal.Title>
                </Modal.Header>
                <Form method='post' onSubmit={submitHandler}>
                    <Modal.Body>
                        <Form.Group className='mb-3'>
                            <Form.Label htmlFor='password'>
                                Новый пароль
                            </Form.Label>
                            <Form.Control
                                required
                                autoFocus
                                id='password'
                                name='password'
                                type='password'
                                value={enteredPassword}
                                onChange={passwordChangeHandler}
                            />
                        </Form.Group>
                        <Form.Group className='mb-3'>
                            <Form.Label htmlFor='passwordRepeat'>
                                Пароль ещё раз
                            </Form.Label>
                            <Form.Control
                                required
                                id='passwordRepeat'
                                name='passwordRepeat'
                                type='password'
                                value={enteredRepeatedPassword}
                                onChange={repeatedPasswordChangeHandler}
                            />
                        </Form.Group>
                        <Form.Group className='mb-3'>
                            <Form.Check
                                checked={sendPassword}
                                type='switch'
                                id='sendPassword'
                                name='sendPassword'
                                label='Отправить учётные данные на email'
                                value={sendPassword}
                                onChange={sendPasswordChangeHandler}
                            />
                        </Form.Group>
                        {!validated && (
                            <Form.Group className='mb-3'>
                                <Alert variant='danger'>
                                    Пароли не совпадают.
                                </Alert>
                            </Form.Group>
                        )}
                    </Modal.Body>
                    <Modal.Footer>
                        <Button variant='secondary' onClick={handleClose}>
                            Закрыть
                        </Button>
                        <Button
                            variant='primary'
                            type='submit'
                            name='intent'
                            value='reset-password'
                        >
                            <RiSaveLine /> Сбросить
                        </Button>
                    </Modal.Footer>
                </Form>
            </Modal>
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

export default ResetPassword;
